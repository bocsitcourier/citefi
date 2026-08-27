import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getTxDb } from "@/lib/db";
import { runWithSystemContext } from "@/lib/tenant-context";
import {
  notifications,
  telemetryAiAnalyses,
  telemetryEvents,
  telemetryIncidentAudit,
  telemetryIncidents,
  telemetryNotificationDeliveries,
  users,
} from "@/shared/schema";
import { createTelemetryEvent, redactString, sanitizeMetadata, sanitizeTelemetryEvent, type IncidentStatus, type TelemetryEvent, type TelemetryInput, type TelemetrySeverity } from "./core";
import { replaySpool, spoolEvent } from "./spool";
import { classifyIncidentChange, shouldNotifyAdmin, type IncidentChange } from "./policy";
export { classifyIncidentChange, shouldNotifyAdmin, type IncidentChange } from "./policy";

export interface PersistResult {
  incidentId?: string;
  evidenceVersion?: number;
  change: IncidentChange;
}

export async function persistTelemetryEvent(event: TelemetryEvent): Promise<PersistResult> {
  // Treat callers and old spool entries as untrusted even when they already
  // carry the TelemetryEvent shape.
  event = sanitizeTelemetryEvent(event);
  return runWithSystemContext("global incident telemetry ingestion", async () => {
    const db = getTxDb();
    return db.transaction(async (tx: any) => {
      // The event id is the ingestion receipt. Replay and caller retries become
      // no-ops before they can increment the aggregate.
      const insertedEvents = await tx.insert(telemetryEvents).values({
        eventId: event.eventId,
        occurredAt: new Date(event.occurredAt),
        environment: event.environment,
        release: event.release ?? null,
        process: event.process,
        severity: event.severity,
        category: event.category,
        fingerprint: event.fingerprint,
        message: event.message,
        stack: event.stack ?? null,
        requestId: event.correlation.requestId ?? null,
        jobId: event.correlation.jobId ?? null,
        deployId: event.correlation.deployId ?? null,
        metadata: event.metadata,
      }).onConflictDoNothing({ target: telemetryEvents.eventId }).returning({ eventId: telemetryEvents.eventId });
      if (insertedEvents.length === 0) return { change: "duplicate" as const };

      // Serialize the read/upsert/classification/audit unit for one aggregate.
      // The unique index alone prevents duplicate rows but cannot make the
      // previous-state classification race-free.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${event.fingerprint + "\0" + event.environment}, 0))`);
      let previous = await tx.select({
        id: telemetryIncidents.id,
        severity: telemetryIncidents.severity,
        status: telemetryIncidents.status,
      }).from(telemetryIncidents).where(and(
        eq(telemetryIncidents.fingerprint, event.fingerprint),
        eq(telemetryIncidents.environment, event.environment),
      )).limit(1);
      if (previous[0]) {
        // Coordinate ingestion-driven reopen with concurrent admin transitions.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${previous[0].id}, 1))`);
        previous = await tx.select({
          id: telemetryIncidents.id,
          severity: telemetryIncidents.severity,
          status: telemetryIncidents.status,
        }).from(telemetryIncidents).where(eq(telemetryIncidents.id, previous[0].id)).limit(1);
      }

      const rows = await tx.insert(telemetryIncidents).values({
        fingerprint: event.fingerprint,
        environment: event.environment,
        category: event.category,
        severity: event.severity,
        title: event.message.slice(0, 500),
        firstSeenAt: new Date(event.occurredAt),
        lastSeenAt: new Date(event.occurredAt),
      }).onConflictDoUpdate({
        target: [telemetryIncidents.fingerprint, telemetryIncidents.environment],
        set: {
          occurrenceCount: sql`${telemetryIncidents.occurrenceCount} + 1`,
          evidenceVersion: sql`${telemetryIncidents.evidenceVersion} + 1`,
          lastSeenAt: sql`GREATEST(${telemetryIncidents.lastSeenAt}, ${new Date(event.occurredAt)})`,
          updatedAt: new Date(),
          severity: sql`CASE
            WHEN ${telemetryIncidents.severity} = 'critical' OR ${event.severity} = 'critical' THEN 'critical'
            WHEN ${telemetryIncidents.severity} = 'error' OR ${event.severity} = 'error' THEN 'error'
            ELSE 'warning' END`,
          status: sql`CASE WHEN ${telemetryIncidents.status} = 'resolved' THEN 'open' ELSE ${telemetryIncidents.status} END`,
          resolvedAt: null,
        },
      }).returning({
        id: telemetryIncidents.id,
        severity: telemetryIncidents.severity,
        evidenceVersion: telemetryIncidents.evidenceVersion,
      });
      const incident = rows[0]!;
      await tx.update(telemetryEvents).set({ incidentId: incident.id }).where(eq(telemetryEvents.eventId, event.eventId));
      let change: IncidentChange = classifyIncidentChange(
        true,
        (previous[0]?.severity as TelemetrySeverity | undefined) ??
          (incident.evidenceVersion > 1 ? (incident.severity as TelemetrySeverity) : undefined),
        incident.severity as TelemetrySeverity,
      );
      if (previous[0]?.status === "resolved") change = "regressed";
      if (!previous[0]) {
        await tx.insert(telemetryIncidentAudit).values({
          incidentId: incident.id, action: "created", toStatus: "open",
        });
      } else if (previous[0].status === "resolved") {
        await tx.insert(telemetryIncidentAudit).values({
          incidentId: incident.id,
          action: "regressed",
          fromStatus: "resolved",
          toStatus: "open",
          note: "New matching telemetry automatically reopened this incident.",
        });
      }
      return { incidentId: incident.id, evidenceVersion: incident.evidenceVersion, change };
    }) as Promise<PersistResult>;
  });
}

export async function notifyAdminsForIncident(
  incidentId: string,
  evidenceVersion: number,
  change: IncidentChange,
  severity: TelemetrySeverity,
  message: string,
): Promise<number> {
  if (!shouldNotifyAdmin(change, severity)) return 0;
  return runWithSystemContext("critical incident admin notification", async () => {
    const db = getTxDb();
    const admins = await db.select({ id: users.id }).from(users).where(and(
      eq(users.role, "admin"), eq(users.accountStatus, "active"), sql`${users.deletedAt} IS NULL`,
    ));
    let delivered = 0;
    for (const admin of admins) {
      await db.transaction(async (tx: any) => {
        const reservation = await tx.insert(telemetryNotificationDeliveries).values({
          incidentId,
          adminUserId: admin.id,
          notificationKind: change,
          evidenceVersion,
        }).onConflictDoNothing().returning({ id: telemetryNotificationDeliveries.id });
        if (!reservation.length) return;
        await tx.insert(notifications).values({
          userId: admin.id,
          type: "error",
          category: "system",
          title: change === "new"
            ? "Critical Incident Detected"
            : change === "regressed"
              ? "Critical Incident Regressed"
              : "Critical Incident Escalated",
          message: redactString(message, 1000),
          entityType: "telemetry_incident",
          actionUrl: `/admin/error-logs/${incidentId}`,
          read: 0,
          dismissed: 0,
        });
        delivered++;
      });
    }
    return delivered;
  });
}

export async function ingestTelemetry(input: TelemetryInput): Promise<PersistResult & { spooled?: boolean }> {
  const event = createTelemetryEvent(input);
  try {
    const result = await persistTelemetryEvent(event);
    if (result.incidentId && result.evidenceVersion) {
      await notifyAdminsForIncident(
        result.incidentId, result.evidenceVersion, result.change, event.severity, event.message,
      ).catch(() => console.error("[incident] admin notification failed"));
    }
    return result;
  } catch {
    await spoolEvent(event);
    console.error("[incident] database unavailable; event safely spooled");
    return { change: "updated", spooled: true };
  }
}

export async function replayTelemetrySpool() {
  return replaySpool(async (event) => {
    const result = await persistTelemetryEvent(event);
    if (result.incidentId && result.evidenceVersion) {
      await notifyAdminsForIncident(
        result.incidentId,
        result.evidenceVersion,
        result.change,
        event.severity,
        event.message,
      );
    }
  });
}

export async function changeIncidentStatus(args: {
  incidentId: string;
  status: IncidentStatus;
  actorUserId: number;
  note?: string;
}): Promise<boolean> {
  return runWithSystemContext("incident status audit", async () => {
    const db = getTxDb();
    return db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${args.incidentId}, 1))`);
      const current = await tx.select({ status: telemetryIncidents.status }).from(telemetryIncidents)
        .where(eq(telemetryIncidents.id, args.incidentId)).limit(1);
      if (!current.length) return false;
      if (current[0]!.status === args.status) return true;
      const now = new Date();
      await tx.update(telemetryIncidents).set({
        status: args.status,
        acknowledgedAt: args.status === "acknowledged" ? now : undefined,
        acknowledgedBy: args.status === "acknowledged" ? args.actorUserId : undefined,
        resolvedAt: args.status === "resolved" ? now : null,
        updatedAt: now,
      }).where(eq(telemetryIncidents.id, args.incidentId));
      await tx.insert(telemetryIncidentAudit).values({
        incidentId: args.incidentId,
        action: args.status === "acknowledged"
          ? "acknowledged"
          : args.status === "resolved"
            ? "resolved"
            : current[0]!.status === "resolved" && args.status === "open"
              ? "reopened"
              : "status_changed",
        fromStatus: current[0]!.status,
        toStatus: args.status,
        actorUserId: args.actorUserId,
        note: args.note ? redactString(args.note, 1000) : undefined,
      });
      return true;
    }) as Promise<boolean>;
  });
}

export async function assignIncident(args: {
  incidentId: string;
  assigneeUserId: number;
  actorUserId: number;
  note?: string;
}): Promise<boolean> {
  return runWithSystemContext("incident assignment audit", async () => {
    const db = getTxDb();
    return db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${args.incidentId}, 1))`);
      const [incident] = await tx.select({ id: telemetryIncidents.id })
        .from(telemetryIncidents).where(eq(telemetryIncidents.id, args.incidentId)).limit(1);
      if (!incident) return false;
      const [assignee] = await tx.select({ id: users.id }).from(users).where(and(
        eq(users.id, args.assigneeUserId),
        eq(users.role, "admin"),
        eq(users.accountStatus, "active"),
        sql`${users.deletedAt} IS NULL`,
      )).limit(1);
      if (!assignee) {
        const error: any = new Error("Assignee must be an active admin");
        error.statusCode = 400;
        throw error;
      }
      await tx.update(telemetryIncidents).set({
        assigneeUserId: args.assigneeUserId,
        updatedAt: new Date(),
      }).where(eq(telemetryIncidents.id, args.incidentId));
      await tx.insert(telemetryIncidentAudit).values({
        incidentId: args.incidentId,
        action: "assigned",
        actorUserId: args.actorUserId,
        note: args.note ? redactString(args.note, 700) : undefined,
      });
      return true;
    }) as Promise<boolean>;
  });
}

export async function listActiveAdmins() {
  return runWithSystemContext("incident assignee list", async () => getTxDb()
    .select({ id: users.id, email: users.email, fullName: users.fullName })
    .from(users)
    .where(and(
      eq(users.role, "admin"),
      eq(users.accountStatus, "active"),
      sql`${users.deletedAt} IS NULL`,
    ))
    .orderBy(asc(users.email)));
}

export async function listIncidents(options: {
  page?: number;
  limit?: number;
  severity?: TelemetrySeverity;
  status?: IncidentStatus;
  category?: string;
  environment?: string;
} = {}) {
  return runWithSystemContext("admin incident list", async () => {
    const db = getTxDb();
    const page = Math.max(options.page ?? 1, 1);
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const filters = [];
    if (options.severity) filters.push(eq(telemetryIncidents.severity, options.severity));
    if (options.status) filters.push(eq(telemetryIncidents.status, options.status));
    if (options.category) filters.push(eq(telemetryIncidents.category, options.category));
    if (options.environment) filters.push(eq(telemetryIncidents.environment, options.environment));
    const where = filters.length ? and(...filters) : undefined;
    const [items, totals, facets] = await Promise.all([
      db.select().from(telemetryIncidents).where(where)
        .orderBy(desc(telemetryIncidents.lastSeenAt))
        .limit(limit).offset((page - 1) * limit),
      db.select({ count: sql<number>`count(*)::int` }).from(telemetryIncidents).where(where),
      Promise.all([
        db.selectDistinct({ value: telemetryIncidents.category }).from(telemetryIncidents).orderBy(asc(telemetryIncidents.category)),
        db.selectDistinct({ value: telemetryIncidents.environment }).from(telemetryIncidents).orderBy(asc(telemetryIncidents.environment)),
      ]),
    ]);
    const total = Number(totals[0]?.count ?? 0);
    return {
      incidents: items,
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      hasMore: page * limit < total,
      facets: {
        categories: facets[0].map((row) => row.value),
        environments: facets[1].map((row) => row.value),
      },
    };
  });
}

export async function getIncidentDetail(incidentId: string) {
  return runWithSystemContext("admin incident detail", async () => {
    const db = getTxDb();
    const [incident] = await db.select().from(telemetryIncidents)
      .where(eq(telemetryIncidents.id, incidentId)).limit(1);
    if (!incident) return null;
    const [events, audit, analyses] = await Promise.all([
      db.select().from(telemetryEvents).where(eq(telemetryEvents.incidentId, incidentId))
        .orderBy(desc(telemetryEvents.occurredAt)).limit(50),
      db.select().from(telemetryIncidentAudit).where(eq(telemetryIncidentAudit.incidentId, incidentId))
        .orderBy(asc(telemetryIncidentAudit.createdAt)),
      db.select().from(telemetryAiAnalyses).where(eq(telemetryAiAnalyses.incidentId, incidentId))
        .orderBy(desc(telemetryAiAnalyses.evidenceVersion)).limit(1),
    ]);
    const userIds = new Set<number>();
    if (incident.acknowledgedBy) userIds.add(incident.acknowledgedBy);
    if (incident.assigneeUserId) userIds.add(incident.assigneeUserId);
    for (const entry of audit) if (entry.actorUserId) userIds.add(entry.actorUserId);
    const people = userIds.size
      ? await db.select({ id: users.id, email: users.email, fullName: users.fullName })
        .from(users).where(inArray(users.id, [...userIds]))
      : [];
    const peopleById = new Map(people.map((person) => [person.id, person]));
    return {
      incident,
      component: events[0]?.process ?? null,
      correlationIds: {
        requestIds: [...new Set(events.map((event) => event.requestId).filter(Boolean))],
        jobIds: [...new Set(events.map((event) => event.jobId).filter(Boolean))],
        deployIds: [...new Set(events.map((event) => event.deployId).filter(Boolean))],
      },
      evidence: events.map((event) => ({
        id: event.eventId,
        occurredAt: event.occurredAt,
        receivedAt: event.receivedAt,
        severity: event.severity,
        message: redactString(event.message, 8_000),
        stack: event.stack ? redactString(event.stack, 32_000) : null,
        process: event.process,
        release: event.release,
        correlation: { requestId: event.requestId, jobId: event.jobId, deployId: event.deployId },
        metadata: sanitizeMetadata(event.metadata),
      })),
      audit: audit.map((entry) => ({
        ...entry,
        actor: entry.actorUserId ? peopleById.get(entry.actorUserId) ?? null : null,
        note: entry.note ? redactString(entry.note, 1000) : null,
      })),
      assignee: incident.assigneeUserId ? peopleById.get(incident.assigneeUserId) ?? null : null,
      analysis: analyses[0] ?? null,
    };
  });
}

export async function getIncidentReport(window: "24h" | "7d") {
  return runWithSystemContext("admin incident report", async () => {
    const db = getTxDb();
    const since = new Date(Date.now() - (window === "24h" ? 24 : 168) * 60 * 60 * 1000);
    const period = gte(telemetryIncidents.lastSeenAt, since);
    const [summaryRows, regressedRows, topFingerprints, topCategories, topComponents] = await Promise.all([
      db.select({
        total: sql<number>`count(*)::int`,
        critical: sql<number>`count(*) filter (where ${telemetryIncidents.severity} = 'critical')::int`,
        newCount: sql<number>`count(*) filter (where ${telemetryIncidents.firstSeenAt} >= ${since})::int`,
        open: sql<number>`count(*) filter (where ${telemetryIncidents.status} <> 'resolved')::int`,
        mttaMinutes: sql<number | null>`avg(extract(epoch from (${telemetryIncidents.acknowledgedAt} - ${telemetryIncidents.firstSeenAt})) / 60)`,
        mttrMinutes: sql<number | null>`avg(extract(epoch from (${telemetryIncidents.resolvedAt} - ${telemetryIncidents.firstSeenAt})) / 60)`,
      }).from(telemetryIncidents).where(period),
      db.select({ count: sql<number>`count(distinct ${telemetryIncidentAudit.incidentId})::int` })
        .from(telemetryIncidentAudit).where(and(
          gte(telemetryIncidentAudit.createdAt, since),
          eq(telemetryIncidentAudit.fromStatus, "resolved"),
          sql`${telemetryIncidentAudit.toStatus} <> 'resolved'`,
        )),
      db.select({ key: telemetryIncidents.fingerprint, count: sql<number>`sum(${telemetryIncidents.occurrenceCount})::int` })
        .from(telemetryIncidents).where(period).groupBy(telemetryIncidents.fingerprint).orderBy(desc(sql`sum(${telemetryIncidents.occurrenceCount})`)).limit(5),
      db.select({ key: telemetryIncidents.category, count: sql<number>`count(*)::int` })
        .from(telemetryIncidents).where(period).groupBy(telemetryIncidents.category).orderBy(desc(sql`count(*)`)).limit(5),
      db.select({ key: telemetryEvents.process, count: sql<number>`count(*)::int` }).from(telemetryEvents)
        .where(gte(telemetryEvents.occurredAt, since)).groupBy(telemetryEvents.process).orderBy(desc(sql`count(*)`)).limit(5),
    ]);
    const summary = summaryRows[0];
    return {
      window,
      since,
      totals: {
        total: Number(summary?.total ?? 0),
        critical: Number(summary?.critical ?? 0),
        new: Number(summary?.newCount ?? 0),
        regressed: Number(regressedRows[0]?.count ?? 0),
        open: Number(summary?.open ?? 0),
      },
      mttaMinutes: summary?.mttaMinutes == null ? null : Number(summary.mttaMinutes),
      mttrMinutes: summary?.mttrMinutes == null ? null : Number(summary.mttrMinutes),
      top: { fingerprints: topFingerprints, categories: topCategories, components: topComponents },
    };
  });
}

export async function queryIncidentReport(options: {
  since?: Date;
  status?: IncidentStatus[];
  severity?: TelemetrySeverity[];
  limit?: number;
} = {}) {
  return runWithSystemContext("incident intelligence report", async () => {
    const filters = [];
    if (options.since) filters.push(gte(telemetryIncidents.lastSeenAt, options.since));
    if (options.status?.length) filters.push(inArray(telemetryIncidents.status, options.status));
    if (options.severity?.length) filters.push(inArray(telemetryIncidents.severity, options.severity));
    return getTxDb().select().from(telemetryIncidents)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(telemetryIncidents.lastSeenAt))
      .limit(Math.min(Math.max(options.limit ?? 100, 1), 500));
  });
}