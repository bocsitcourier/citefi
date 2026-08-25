import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getTxDb, withTenantTransaction } from "./db";
import { deliverEmail, type EmailPayload } from "./email";
import { getDatabaseExecutionContext } from "./tenant-context";
import {
  agencyClientReports, agencyReportConfigs, agencyReportDeliveries, agencyReportFinancialSnapshots,
  teams,
} from "@/shared/schema";

export const reportRecipientsSchema = z.array(z.string().email()).max(100);
export const reportSectionFlagsSchema = z.record(z.string(), z.boolean());
export const agencyReportConfigInputSchema = z.object({
  clientTeamId: z.number().int().positive(),
  displayName: z.string().trim().min(1).max(255),
  logoUrl: z.string().url().regex(/^https?:\/\//i, "logoUrl must use http or https").nullable().optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  recipients: reportRecipientsSchema.default([]),
  cadence: z.enum(["monthly", "manual"]),
  clientVisibleSections: reportSectionFlagsSchema,
  markupBasisPoints: z.number().int().min(0).max(100_000),
});
export const reportPeriodSchema = z.object({
  clientTeamId: z.number().int().positive(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
}).refine((p) => p.periodEnd > p.periodStart, "periodEnd must be after periodStart");
export const reportDeliverySchema = z.object({
  reportId: z.number().int().positive(),
  channel: z.enum(["email", "download", "portal"]),
  recipient: z.string().trim().min(1).max(320),
  status: z.enum(["pending", "sent", "delivered", "failed"]),
  error: z.string().min(1).nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(255),
}).refine((v) => v.status !== "failed" || !!v.error, "failed delivery requires error");

const PRIVATE_KEY = /(prompt|provider|model|cogs|cost|margin|markup|rebill|rate.?snapshot|internal|error|other.?client)/i;

/** Defense in depth for snapshots; keys carrying operational/accounting data are removed recursively. */
export function sanitizeClientSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeClientSnapshot);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PRIVATE_KEY.test(key))
      .map(([key, child]) => [key, sanitizeClientSnapshot(child)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function deterministicReportSha256(clientSafe: unknown, agencyOnly: unknown): string {
  return createHash("sha256").update(canonicalJson({ clientSafe, agencyOnly })).digest("hex");
}

function safeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
}

export function reconcileAgencyRebilling(
  providerCostMicrousd: number,
  creditDebits: number,
  config: { approvalStatus: string; markupBasisPoints: number },
) {
  safeInteger(providerCostMicrousd, "providerCostMicrousd");
  safeInteger(creditDebits, "creditDebits");
  if (providerCostMicrousd < 0 || creditDebits < 0) throw new Error("Rebilling inputs must be non-negative");
  const approved = config.approvalStatus === "approved";
  const revenueMicrousd = approved
    ? Number((BigInt(providerCostMicrousd) * BigInt(10_000 + config.markupBasisPoints) + 5_000n) / 10_000n)
    : null;
  if (revenueMicrousd != null) safeInteger(revenueMicrousd, "revenueMicrousd");
  return {
    providerCostMicrousd,
    creditDebits,
    approvedMarkupBasisPoints: approved ? config.markupBasisPoints : null,
    revenueMicrousd,
    marginMicrousd: revenueMicrousd == null ? null : revenueMicrousd - providerCostMicrousd,
    revenueAvailable: approved,
  };
}

function agencyActor(): { agencyTeamId: number; userId: number } {
  const context = getDatabaseExecutionContext();
  if (!context || context.scope !== "tenant" || context.actorType !== "web"
    || !context.userId || !["owner", "admin", "platform_admin"].includes(context.role)) {
    throw new Error("Agency report operation requires an authenticated agency owner or admin");
  }
  return { agencyTeamId: context.teamId, userId: context.userId };
}

export async function enforceAgencyDirectChild(clientTeamId: number) {
  const actor = agencyActor();
  const db = getTxDb();
  await assertAgencyDirectChild(db, actor.agencyTeamId, clientTeamId);
  return actor;
}

async function assertAgencyDirectChild(
  db: ReturnType<typeof getTxDb>,
  agencyTeamId: number,
  clientTeamId: number,
) {
  const [row] = await db.select({ id: teams.id }).from(teams).where(and(
    eq(teams.id, clientTeamId), eq(teams.parentTeamId, agencyTeamId),
    eq(teams.clientStatus, "active"), sql`${teams.deletedAt} IS NULL`,
    sql`EXISTS (SELECT 1 FROM teams agency WHERE agency.id=${agencyTeamId} AND agency.billing_plan='agency' AND agency.deleted_at IS NULL)`,
  )).limit(1);
  if (!row) throw new Error("Client must be an active direct child of the authenticated agency plan");
}

export async function upsertAgencyReportConfig(input: z.input<typeof agencyReportConfigInputSchema>) {
  const parsed = agencyReportConfigInputSchema.parse(input);
  const actor = await enforceAgencyDirectChild(parsed.clientTeamId);
  const db = getTxDb();
  const [row] = await db.insert(agencyReportConfigs).values({
    agencyTeamId: actor.agencyTeamId, clientTeamId: parsed.clientTeamId,
    displayName: parsed.displayName, logoUrl: parsed.logoUrl ?? null,
    accentColor: parsed.accentColor ?? null, recipientsJson: parsed.recipients,
    cadence: parsed.cadence, clientVisibleSectionsJson: parsed.clientVisibleSections,
    markupBasisPoints: parsed.markupBasisPoints,
    // Any edit invalidates the commercial approval.
    approvalStatus: "draft", approvedBy: null, approvedAt: null, updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [agencyReportConfigs.agencyTeamId, agencyReportConfigs.clientTeamId],
    set: {
      displayName: parsed.displayName, logoUrl: parsed.logoUrl ?? null,
      accentColor: parsed.accentColor ?? null, recipientsJson: parsed.recipients,
      cadence: parsed.cadence, clientVisibleSectionsJson: parsed.clientVisibleSections,
      markupBasisPoints: parsed.markupBasisPoints, approvalStatus: "draft",
      approvedBy: null, approvedAt: null, updatedAt: new Date(),
    },
  }).returning();
  return row;
}

export async function approveAgencyReportConfig(clientTeamId: number) {
  const actor = await enforceAgencyDirectChild(clientTeamId);
  const [row] = await getTxDb().update(agencyReportConfigs).set({
    approvalStatus: "approved", approvedBy: actor.userId, approvedAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(agencyReportConfigs.agencyTeamId, actor.agencyTeamId), eq(agencyReportConfigs.clientTeamId, clientTeamId))).returning();
  if (!row) throw new Error("Agency report config not found");
  return row;
}

export async function assembleAgencyPeriodEvidence(clientTeamId: number, periodStart: Date, periodEnd: Date) {
  await enforceAgencyDirectChild(clientTeamId);
  if (periodEnd <= periodStart) throw new Error("periodEnd must be after periodStart");
  const db = getTxDb();
  return assembleAgencyPeriodEvidenceWithDb(db, clientTeamId, periodStart, periodEnd);
}

async function assembleAgencyPeriodEvidenceWithDb(
  db: ReturnType<typeof getTxDb>,
  clientTeamId: number,
  periodStart: Date,
  periodEnd: Date,
) {
  const result = await db.execute(sql`
    SELECT citefi_rls.agency_report_period_evidence(
      ${agencyActor().agencyTeamId}, ${clientTeamId}, ${periodStart}, ${periodEnd}
    ) AS evidence
  `);
  const rows = Array.isArray(result) ? result : (result as any).rows;
  const evidence = rows?.[0]?.evidence;
  if (!evidence || typeof evidence !== "object") {
    throw new Error("Agency report evidence aggregation failed");
  }
  return evidence as {
    period: { start: string; end: string };
    accounting: { providerCostMicrousd: number; creditDebits: number };
    [key: string]: unknown;
  };
}

export async function createAgencyClientReport(input: z.input<typeof reportPeriodSchema>) {
  const parsed = reportPeriodSchema.parse(input);
  const actor = agencyActor();
  const wherePeriod = and(eq(agencyClientReports.agencyTeamId, actor.agencyTeamId),
    eq(agencyClientReports.clientTeamId, parsed.clientTeamId), eq(agencyClientReports.periodStart, parsed.periodStart), eq(agencyClientReports.periodEnd, parsed.periodEnd));
  return withTenantTransaction(async (tx) => {
    await assertAgencyDirectChild(tx, actor.agencyTeamId, parsed.clientTeamId);
    const [alreadyCreated] = await tx.select().from(agencyClientReports).where(wherePeriod).limit(1);
    if (alreadyCreated) {
      const [financial] = await tx.select({ rebillingSnapshot: agencyReportFinancialSnapshots.rebillingSnapshot })
        .from(agencyReportFinancialSnapshots)
        .where(eq(agencyReportFinancialSnapshots.reportId, alreadyCreated.id)).limit(1);
      if (!financial) throw new Error("Agency report financial snapshot not found");
      return {
        report: { ...alreadyCreated, agencyRebillingSnapshot: financial.rebillingSnapshot },
        inserted: false,
      };
    }
    // Lock the approved commercial configuration through commit. Together
    // with REPEATABLE READ this makes branding, evidence, and both immutable
    // snapshots one consistent point-in-time view.
    const [config] = await tx.select().from(agencyReportConfigs).where(and(
      eq(agencyReportConfigs.agencyTeamId, actor.agencyTeamId),
      eq(agencyReportConfigs.clientTeamId, parsed.clientTeamId),
    )).for("share").limit(1);
    if (!config) throw new Error("Agency report config not found");
    if (config.approvalStatus !== "approved") {
      throw new Error("Agency report config must be approved before generating a report");
    }
    const evidence = await assembleAgencyPeriodEvidenceWithDb(
      tx, parsed.clientTeamId, parsed.periodStart, parsed.periodEnd);
    const visible = config.clientVisibleSectionsJson as Record<string, boolean>;
    const clientSafeSnapshot = sanitizeClientSnapshot({
      period: evidence.period,
      branding: { displayName: config.displayName, logoUrl: config.logoUrl, accentColor: config.accentColor },
      ...Object.fromEntries(Object.entries(evidence)
        .filter(([key]) => key !== "accounting" && key !== "period" && visible[key] !== false)),
    });
    const agencyRebillingSnapshot = reconcileAgencyRebilling(
      evidence.accounting.providerCostMicrousd, evidence.accounting.creditDebits, config);
    const snapshotSha256 = deterministicReportSha256(clientSafeSnapshot, agencyRebillingSnapshot);
    const [report] = await tx.insert(agencyClientReports).values({
      agencyTeamId: actor.agencyTeamId, clientTeamId: parsed.clientTeamId, generatedBy: actor.userId,
      periodStart: parsed.periodStart, periodEnd: parsed.periodEnd, clientSafeSnapshot, snapshotSha256,
    }).onConflictDoNothing().returning();
    if (report) {
      await tx.insert(agencyReportFinancialSnapshots).values({
        reportId: report.id,
        agencyTeamId: actor.agencyTeamId,
        clientTeamId: parsed.clientTeamId,
        rebillingSnapshot: agencyRebillingSnapshot,
      });
      return { report: { ...report, agencyRebillingSnapshot }, inserted: true };
    }
    const [raced] = await tx.select().from(agencyClientReports).where(wherePeriod).limit(1);
    if (!raced) throw new Error("Report idempotency conflict did not resolve");
    const [financial] = await tx.select({ rebillingSnapshot: agencyReportFinancialSnapshots.rebillingSnapshot })
      .from(agencyReportFinancialSnapshots)
      .where(eq(agencyReportFinancialSnapshots.reportId, raced.id)).limit(1);
    if (!financial) throw new Error("Agency report financial snapshot not found");
    return {
      report: { ...raced, agencyRebillingSnapshot: financial.rebillingSnapshot },
      inserted: false,
    };
  }, { isolationLevel: "repeatable read", maxRetries: 5 });
}

export async function approveAgencyClientReport(reportId: number) {
  const actor = agencyActor();
  const db = getTxDb();
  const [existing] = await db.select({
    id: agencyClientReports.id, status: agencyClientReports.status,
    clientTeamId: agencyClientReports.clientTeamId,
  }).from(agencyClientReports).where(and(
    eq(agencyClientReports.id, reportId),
    eq(agencyClientReports.agencyTeamId, actor.agencyTeamId),
  )).limit(1);
  if (!existing) throw new Error("Agency report not found");
  if (existing.status === "approved" || existing.status === "sent") {
    return (await getAgencyReportDetail(reportId))!.report;
  }
  const [config] = await db.select({ approvalStatus: agencyReportConfigs.approvalStatus })
    .from(agencyReportConfigs).where(and(
      eq(agencyReportConfigs.agencyTeamId, actor.agencyTeamId),
      eq(agencyReportConfigs.clientTeamId, existing.clientTeamId),
    )).limit(1);
  if (config?.approvalStatus !== "approved") {
    throw new Error("Agency report config must be approved before approving a report");
  }
  const [report] = await db.update(agencyClientReports).set({
    status: "approved", approvedBy: actor.userId, approvedAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(agencyClientReports.id, reportId), eq(agencyClientReports.agencyTeamId, actor.agencyTeamId),
    eq(agencyClientReports.status, "draft"))).returning();
  if (!report) throw new Error("Agency report not found");
  return (await getAgencyReportDetail(reportId))!.report;
}

export async function recordAgencyReportDelivery(input: z.input<typeof reportDeliverySchema>) {
  const parsed = reportDeliverySchema.parse(input);
  const actor = agencyActor();
  const db = getTxDb();
  const [report] = await db.select({ id: agencyClientReports.id, clientTeamId: agencyClientReports.clientTeamId })
    .from(agencyClientReports).where(and(eq(agencyClientReports.id, parsed.reportId), eq(agencyClientReports.agencyTeamId, actor.agencyTeamId))).limit(1);
  if (!report) throw new Error("Agency report not found");
  const [delivery] = await db.insert(agencyReportDeliveries).values({
    reportId: report.id, agencyTeamId: actor.agencyTeamId, clientTeamId: report.clientTeamId,
    channel: parsed.channel, recipient: parsed.recipient, status: parsed.status,
    error: parsed.error ?? null, idempotencyKey: parsed.idempotencyKey,
  }).onConflictDoNothing().returning();
  if (delivery) return { delivery, inserted: true };
  const [existing] = await db.select().from(agencyReportDeliveries).where(and(
    eq(agencyReportDeliveries.reportId, report.id), eq(agencyReportDeliveries.idempotencyKey, parsed.idempotencyKey))).limit(1);
  if (!existing || existing.channel !== parsed.channel || existing.recipient !== parsed.recipient) {
    throw new Error("Delivery idempotency key is bound to a different delivery");
  }
  return { delivery: existing, inserted: false };
}

const agencyConfigProjection = {
  id: agencyReportConfigs.id, clientTeamId: agencyReportConfigs.clientTeamId,
  displayName: agencyReportConfigs.displayName, logoUrl: agencyReportConfigs.logoUrl,
  accentColor: agencyReportConfigs.accentColor, recipients: agencyReportConfigs.recipientsJson,
  cadence: agencyReportConfigs.cadence, clientVisibleSections: agencyReportConfigs.clientVisibleSectionsJson,
  markupBasisPoints: agencyReportConfigs.markupBasisPoints, approvalStatus: agencyReportConfigs.approvalStatus,
  approvedAt: agencyReportConfigs.approvedAt, createdAt: agencyReportConfigs.createdAt,
  updatedAt: agencyReportConfigs.updatedAt,
};

const agencyReportProjection = {
  id: agencyClientReports.id, clientTeamId: agencyClientReports.clientTeamId,
  periodStart: agencyClientReports.periodStart, periodEnd: agencyClientReports.periodEnd,
  status: agencyClientReports.status, clientSafeSnapshot: agencyClientReports.clientSafeSnapshot,
  snapshotSha256: agencyClientReports.snapshotSha256, approvedAt: agencyClientReports.approvedAt,
  createdAt: agencyClientReports.createdAt, updatedAt: agencyClientReports.updatedAt,
};

const agencyReportWithFinancialProjection = {
  ...agencyReportProjection,
  agencyRebillingSnapshot: agencyReportFinancialSnapshots.rebillingSnapshot,
};

/** Agency dashboard projection, explicitly scoped to one active direct child. */
export async function listAgencyReports(clientTeamId: number) {
  const actor = await enforceAgencyDirectChild(clientTeamId);
  const db = getTxDb();
  const [client, config, reports] = await Promise.all([
    db.select({ id: teams.id, name: teams.name }).from(teams).where(and(
      eq(teams.id, clientTeamId),
      eq(teams.parentTeamId, actor.agencyTeamId),
    )).limit(1),
    db.select(agencyConfigProjection).from(agencyReportConfigs).where(and(
      eq(agencyReportConfigs.agencyTeamId, actor.agencyTeamId),
      eq(agencyReportConfigs.clientTeamId, clientTeamId),
    )).limit(1),
    db.select(agencyReportWithFinancialProjection).from(agencyClientReports)
      .innerJoin(agencyReportFinancialSnapshots, eq(agencyReportFinancialSnapshots.reportId, agencyClientReports.id))
      .where(and(
      eq(agencyClientReports.agencyTeamId, actor.agencyTeamId),
      eq(agencyClientReports.clientTeamId, clientTeamId),
    )).orderBy(desc(agencyClientReports.periodStart)),
  ]);
  const deliveries = await db.select().from(agencyReportDeliveries).where(and(
    eq(agencyReportDeliveries.agencyTeamId, actor.agencyTeamId),
    eq(agencyReportDeliveries.clientTeamId, clientTeamId),
  )).orderBy(desc(agencyReportDeliveries.createdAt));
  return { client: client[0], config: config[0] ?? null, reports, deliveries };
}

/** Full agency-authorized detail; no row from another agency can be observed. */
export async function getAgencyReportDetail(reportId: number) {
  const actor = agencyActor();
  const db = getTxDb();
  const [report] = await db.select(agencyReportWithFinancialProjection).from(agencyClientReports)
    .innerJoin(agencyReportFinancialSnapshots, eq(agencyReportFinancialSnapshots.reportId, agencyClientReports.id))
    .where(and(
    eq(agencyClientReports.id, reportId),
    eq(agencyClientReports.agencyTeamId, actor.agencyTeamId),
  )).limit(1);
  if (!report) return null;
  const deliveries = await db.select().from(agencyReportDeliveries).where(and(
    eq(agencyReportDeliveries.reportId, report.id),
    eq(agencyReportDeliveries.agencyTeamId, actor.agencyTeamId),
  )).orderBy(asc(agencyReportDeliveries.createdAt));
  return { report, deliveries };
}

function escapeHtml(raw: unknown): string {
  return String(raw ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `<ul>${value.map((v) => `<li>${renderValue(v)}</li>`).join("")}</ul>`;
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => `<section><h3>${escapeHtml(key)}</h3>${renderValue(child)}</section>`).join("");
  }
  return `<p>${escapeHtml(value)}</p>`;
}

/** Render only the recursively sanitized snapshot, with no scripts or remote stylesheets. */
export function renderClientSafeReportHtml(snapshot: unknown): string {
  const safe = sanitizeClientSnapshot(snapshot) as Record<string, unknown>;
  const branding = safe?.branding && typeof safe.branding === "object"
    ? safe.branding as Record<string, unknown> : {};
  const accent = typeof branding.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(branding.accentColor)
    ? branding.accentColor : "#2563eb";
  const title = branding.displayName || "Client report";
  const logo = typeof branding.logoUrl === "string"
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(title)} logo">` : "";
  const body = Object.entries(safe ?? {}).filter(([key]) => key !== "branding")
    .map(([key, value]) => `<section class="card"><h2>${escapeHtml(key)}</h2>${renderValue(value)}</section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>:root{--accent:${accent}}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;max-width:900px;margin:0 auto;padding:32px;background:#f6f8fb}header{border-bottom:4px solid var(--accent);padding-bottom:18px}img{max-width:180px;max-height:70px}.card{background:#fff;border-radius:8px;padding:20px;margin:18px 0}h1,h2{color:var(--accent)}h3{margin-bottom:4px}p{margin-top:4px}ul{padding-left:22px}</style></head><body><header>${logo}<h1>${escapeHtml(title)}</h1></header><main>${body}</main></body></html>`;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderAgencyRebillingCsv(snapshot: unknown): string {
  const row = snapshot && typeof snapshot === "object" ? snapshot as Record<string, unknown> : {};
  if (row.revenueAvailable !== true || row.revenueMicrousd == null) {
    throw new Error("Approved rebilling is not available for this report");
  }
  const columns = ["providerCostMicrousd", "creditDebits", "approvedMarkupBasisPoints",
    "revenueMicrousd", "marginMicrousd", "revenueAvailable"];
  return `${columns.join(",")}\r\n${columns.map((key) => csvCell(row[key])).join(",")}\r\n`;
}

export type AgencyEmailDeliverer = (payload: EmailPayload) => Promise<void>;
export type AgencyDeliveryRecorder = typeof recordAgencyReportDelivery;

/**
 * Send each recipient at most once. A transaction-level advisory lock closes
 * the deliver-before-audit race without mutating append-only delivery rows.
 */
export async function sendApprovedAgencyReport(
  reportId: number,
  send: AgencyEmailDeliverer = deliverEmail,
  recordTerminal: AgencyDeliveryRecorder = recordAgencyReportDelivery,
) {
  const actor = agencyActor();
  const detail = await getAgencyReportDetail(reportId);
  if (!detail) throw new Error("Agency report not found");
  if (!["approved", "sent"].includes(detail.report.status)) throw new Error("Report must be approved before sending");
  const [config] = await getTxDb().select({
    recipients: agencyReportConfigs.recipientsJson, displayName: agencyReportConfigs.displayName,
    approvalStatus: agencyReportConfigs.approvalStatus,
  }).from(agencyReportConfigs).where(and(
    eq(agencyReportConfigs.agencyTeamId, actor.agencyTeamId),
    eq(agencyReportConfigs.clientTeamId, detail.report.clientTeamId),
  )).limit(1);
  if (!config) throw new Error("Agency report config not found");
  if (config.approvalStatus !== "approved") {
    throw new Error("Agency report config must be approved before sending");
  }
  const recipients = reportRecipientsSchema.parse(config.recipients);
  if (recipients.length === 0) throw new Error("No report recipients are configured");
  const html = renderClientSafeReportHtml(detail.report.clientSafeSnapshot);
  const outcomes: Array<{ recipient: string; status: "sent" | "failed" | "skipped" }> = [];
  let hasSuccessfulDelivery = false;
  for (const recipient of recipients) {
    const recipientHash = createHash("sha256").update(recipient.toLowerCase()).digest("hex").slice(0, 32);
    const baseIdempotencyKey = `email:${reportId}:${recipientHash}`;
    const claim = await withTenantTransaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agency-report-email'), hashtext(${baseIdempotencyKey}))`);
      const prior = await tx.select({
        id: agencyReportDeliveries.id, status: agencyReportDeliveries.status,
        idempotencyKey: agencyReportDeliveries.idempotencyKey,
      }).from(agencyReportDeliveries)
        .where(and(eq(agencyReportDeliveries.reportId, reportId),
          eq(agencyReportDeliveries.channel, "email"),
          eq(agencyReportDeliveries.recipient, recipient)))
        .orderBy(asc(agencyReportDeliveries.createdAt));
      if (prior.some((delivery) => delivery.status === "sent" || delivery.status === "delivered")) {
        return { action: "skip-success" as const };
      }
      const pending = prior.filter((delivery) => delivery.status === "pending");
      const unresolvedPending = pending.find((delivery) => {
        const prefix = delivery.idempotencyKey.replace(/:pending$/, "");
        return !prior.some((candidate) =>
          candidate.idempotencyKey === `${prefix}:sent`
          || candidate.idempotencyKey === `${prefix}:failed`);
      });
      if (unresolvedPending) {
        return { action: "skip-uncertain" as const };
      }
      await tx.insert(agencyReportDeliveries).values({
        reportId, agencyTeamId: actor.agencyTeamId, clientTeamId: detail.report.clientTeamId,
        channel: "email", recipient, status: "pending",
        error: null, idempotencyKey: `${baseIdempotencyKey}:attempt:${pending.length + 1}:pending`,
      });
      return { action: "send" as const, attempt: pending.length + 1 };
    });
    if (claim.action !== "send") {
      if (claim.action === "skip-success") hasSuccessfulDelivery = true;
      outcomes.push({ recipient, status: "skipped" });
      continue;
    }
    let status: "sent" | "failed" = "sent";
    try {
      await send({
        to: recipient, subject: `${config.displayName} report`,
        text: `Your ${config.displayName} report is ready.`, html,
      });
    } catch {
      status = "failed";
    }
    await recordTerminal({
      reportId,
      channel: "email",
      recipient,
      status,
      error: status === "failed" ? "Email delivery failed" : null,
      idempotencyKey: `${baseIdempotencyKey}:attempt:${claim.attempt}:${status}`,
    });
    if (status === "sent") hasSuccessfulDelivery = true;
      outcomes.push({ recipient, status });
  }
  if (hasSuccessfulDelivery) {
    await getTxDb().update(agencyClientReports).set({ status: "sent", updatedAt: new Date() })
      .where(and(eq(agencyClientReports.id, reportId),
        eq(agencyClientReports.agencyTeamId, actor.agencyTeamId),
        eq(agencyClientReports.status, "approved")));
  }
  return { reportId, outcomes };
}

/** The only client-facing read contract: accounting/config columns are never selected. */
export async function getApprovedClientSafeReports(clientTeamId: number) {
  const context = getDatabaseExecutionContext();
  if (!context || context.scope !== "tenant" || context.teamId !== clientTeamId) throw new Error("Client report team mismatch");
  const reports = await getTxDb().select({
    id: agencyClientReports.id, periodStart: agencyClientReports.periodStart,
    periodEnd: agencyClientReports.periodEnd, status: agencyClientReports.status,
    clientSafeSnapshot: agencyClientReports.clientSafeSnapshot,
    snapshotSha256: agencyClientReports.snapshotSha256, approvedAt: agencyClientReports.approvedAt,
  }).from(agencyClientReports).where(and(eq(agencyClientReports.clientTeamId, clientTeamId),
    sql`${agencyClientReports.status} IN ('approved','sent')`));
  return reports.map((report) => ({
    ...report, clientSafeSnapshot: sanitizeClientSnapshot(report.clientSafeSnapshot),
  }));
}

export async function getApprovedClientSafeReport(clientTeamId: number, reportId: number) {
  const context = getDatabaseExecutionContext();
  if (!context || context.scope !== "tenant" || context.teamId !== clientTeamId) throw new Error("Client report team mismatch");
  const [report] = await getTxDb().select({
    id: agencyClientReports.id, periodStart: agencyClientReports.periodStart,
    periodEnd: agencyClientReports.periodEnd, status: agencyClientReports.status,
    clientSafeSnapshot: agencyClientReports.clientSafeSnapshot,
    snapshotSha256: agencyClientReports.snapshotSha256, approvedAt: agencyClientReports.approvedAt,
  }).from(agencyClientReports).where(and(eq(agencyClientReports.id, reportId),
    eq(agencyClientReports.clientTeamId, clientTeamId),
    sql`${agencyClientReports.status} IN ('approved','sent')`)).limit(1);
  return report ? {
    ...report, clientSafeSnapshot: sanitizeClientSnapshot(report.clientSafeSnapshot),
  } : null;
}