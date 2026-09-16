import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";

const { withBoundedTransactionRetry } = await import("../lib/db");

type Report = {
  id: number;
  agencyTeamId: number;
  clientTeamId: number;
  periodStart: string;
  periodEnd: string;
};

/**
 * Controlled transaction double: each transaction reads a versioned snapshot
 * and commits all writes together. It models PostgreSQL's serialization
 * failure boundary without connecting to a database or writing rows.
 */
class AgencyReportTransactionDouble {
  private version = 0;
  private nextId = 1;
  private reports: Report[] = [];
  private financialSnapshots = new Map<number, { reportId: number; agencyTeamId: number; clientTeamId: number }>();

  begin() {
    const snapshotVersion = this.version;
    const pendingReports: Report[] = [];
    const pendingFinancial = new Map<number, { reportId: number; agencyTeamId: number; clientTeamId: number }>();
    const key = (report: Pick<Report, "agencyTeamId" | "clientTeamId" | "periodStart" | "periodEnd">) =>
      [report.agencyTeamId, report.clientTeamId, report.periodStart, report.periodEnd].join(":");

    return {
      find: (candidate: Pick<Report, "agencyTeamId" | "clientTeamId" | "periodStart" | "periodEnd">) =>
        [...this.reports, ...pendingReports].find((report) => key(report) === key(candidate)),
      insert: (candidate: Omit<Report, "id">) => {
        const report = { ...candidate, id: this.nextId + pendingReports.length };
        pendingReports.push(report);
        return report;
      },
      insertFinancial: (report: Report) => {
        if (pendingFinancial.has(report.id) || this.financialSnapshots.has(report.id)) {
          throw new Error("financial snapshot uniqueness violation");
        }
        pendingFinancial.set(report.id, {
          reportId: report.id,
          agencyTeamId: report.agencyTeamId,
          clientTeamId: report.clientTeamId,
        });
      },
      commit: () => {
        if (snapshotVersion !== this.version) {
          const error = Object.assign(new Error("serialization conflict"), { code: "40001" });
          throw error;
        }
        for (const report of pendingReports) this.reports.push(report);
        for (const [reportId, snapshot] of pendingFinancial) this.financialSnapshots.set(reportId, snapshot);
        this.nextId += pendingReports.length;
        this.version++;
      },
    };
  }

  count() {
    return {
      reports: this.reports.length,
      financialSnapshots: this.financialSnapshots.size,
      reportIds: this.reports.map((report) => report.id),
    };
  }
}

test("controlled concurrency double: eight serializable requests converge on one report and snapshot", async () => {
  const store = new AgencyReportTransactionDouble();
  const input = {
    agencyTeamId: 10,
    clientTeamId: 20,
    periodStart: "2042-04-01",
    periodEnd: "2042-05-01",
  };
  const generate = () => withBoundedTransactionRetry(async () => {
    const tx = store.begin();
    const existing = tx.find(input);
    if (existing) {
      await Promise.resolve();
      return { id: existing.id, inserted: false };
    }
    const report = tx.insert(input);
    tx.insertFinancial(report);
    await Promise.resolve();
    tx.commit();
    return { id: report.id, inserted: true };
  }, { maxRetries: 5 });

  const results = await Promise.all(Array.from({ length: 8 }, generate));
  const state = store.count();
  assert.equal(state.reports, 1);
  assert.equal(state.financialSnapshots, 1);
  assert.deepEqual(new Set(results.map((result) => result.id)), new Set([1]));
  assert.equal(results.filter((result) => result.inserted).length, 1);
});

test("controlled transaction double retries the entire callback for 40001 and 40P01", async () => {
  for (const code of ["40001", "40P01"]) {
    let callbacks = 0;
    const result = await withBoundedTransactionRetry(async (attempt) => {
      callbacks++;
      if (attempt === 0) throw Object.assign(new Error(code), { code });
      return "committed";
    }, { maxRetries: 1 });
    assert.equal(result, "committed");
    assert.equal(callbacks, 2);
  }
});

test("controlled transaction double propagates non-retryable errors and honors bounded attempts", async () => {
  let nonRetryableCallbacks = 0;
  await assert.rejects(
    withBoundedTransactionRetry(async () => {
      nonRetryableCallbacks++;
      throw Object.assign(new Error("check violation"), { code: "23514" });
    }, { maxRetries: 5 }),
    (error: Error & { code?: string }) => error.code === "23514",
  );
  assert.equal(nonRetryableCallbacks, 1);

  let boundedCallbacks = 0;
  await assert.rejects(
    withBoundedTransactionRetry(async () => {
      boundedCallbacks++;
      throw Object.assign(new Error("serialization conflict"), { code: "40001" });
    }, { maxRetries: 2 }),
    (error: Error & { code?: string }) => error.code === "40001",
  );
  assert.equal(boundedCallbacks, 3);
});