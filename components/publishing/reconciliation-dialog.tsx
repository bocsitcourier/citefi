"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, FileCheck2, Loader2, ShieldCheck } from "lucide-react";
import { apiRequest, csrfFetch, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface ReconciliationJob {
  id: number;
  publicId: string;
  status: string;
  reconciliationStatus?: "unresolved" | "accepted" | "not_accepted" | "conflicting_evidence" | null;
  replacementJobId?: number | null;
}

interface Receipt {
  id: number;
  outcome: string;
  receiptId: string;
  observedAt: string;
  pageUrl?: string;
  digest: string;
  source: string;
  at: string;
  actorId: number;
}

interface ReconciliationData {
  jobId: number;
  publicId: string;
  status: string;
  attempt: string | null;
  updatedAt: string;
  legacy: boolean;
  receiverOrigin: string | null;
  canLiveCheck: boolean;
  conflict: boolean;
  decision: {
    outcome: string;
    reason: string;
    actorId: number;
    at: string;
    receiptId: number;
    decisionId: string;
  } | null;
  replacementJobId: number | null;
  receipts: Receipt[];
  audit: { action: string; actorId: number; at: string; reason?: string }[];
}

interface ReconciliationDialogProps {
  job: ReconciliationJob;
}

function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function outcomeLabel(outcome: string) {
  if (outcome === "accepted") return "Accepted";
  if (outcome === "not_accepted") return "Proven not accepted";
  if (outcome === "outcome_unknown") return "Outcome unresolved";
  return outcome.replaceAll("_", " ");
}

async function loadReconciliation(jobId: number): Promise<ReconciliationData> {
  const response = await csrfFetch(`/api/publishing/jobs/${jobId}/reconciliation`, { method: "GET" });
  const payload = await response.json();
  if (!response.ok || payload?.success !== true) {
    const error = new Error(payload?.error || `Unable to load reconciliation details (${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload.data as ReconciliationData;
}

export function ReconciliationDialog({ job }: ReconciliationDialogProps) {
  const [open, setOpen] = useState(false);
  const [rawReceipt, setRawReceipt] = useState("");
  const [signature, setSignature] = useState("");
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [liveConfirmed, setLiveConfirmed] = useState(false);
  const [liveDialogOpen, setLiveDialogOpen] = useState(false);
  const [replacementDialogOpen, setReplacementDialogOpen] = useState(false);
  const requestLock = useRef(false);
  const decisionIdRef = useRef<string | null>(null);

  const reconciliationQuery = useQuery({
    queryKey: ["/api/publishing/jobs", job.id, "reconciliation"],
    queryFn: () => loadReconciliation(job.id),
    enabled: open,
    retry: false,
  });
  const data = reconciliationQuery.data;
  const eligibleForDecision =
    !!data &&
    !data.legacy &&
    !data.conflict &&
    !data.decision &&
    ["outcome_unknown", "processing", "sent"].includes(data.status) &&
    data.receipts.length > 0;

  const refreshAfterMutation = async () => {
    await Promise.all([
      reconciliationQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ["/api/publishing/jobs"] }),
    ]);
  };

  const postAction = async (body: Record<string, unknown>, successMessage: string, clearDecisionId = false) => {
    if (requestLock.current) return;
    requestLock.current = true;
    setPending(true);
    setErrorMessage("");
    try {
      const response = await apiRequest(`/api/publishing/jobs/${job.id}/reconciliation`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (response?.success !== true) {
        throw new Error(response?.error || "The reconciliation request was not accepted.");
      }
      await refreshAfterMutation();
      if (body.action === "replacement") setReplacementDialogOpen(false);
      if (body.action === "check") setLiveDialogOpen(false);
      if (clearDecisionId) decisionIdRef.current = null;
      setErrorMessage("");
      if (body.action === "import") {
        setRawReceipt("");
        setSignature("");
      }
      if (body.action === "check") {
        setLiveConfirmed(false);
        setLiveDialogOpen(false);
      }
      if (body.action === "replacement") setReplacementDialogOpen(false);
      if (successMessage) setErrorMessage(successMessage);
    } catch (error) {
      const requestError = error as Error & { status?: number };
      setErrorMessage(
        requestError.status === 409
          ? "This job changed while you were reviewing it. Details have been refreshed; review the latest evidence before continuing."
          : requestError.message || "The reconciliation request could not be completed."
      );
      if (requestError.status === 409) await refreshAfterMutation();
    } finally {
      requestLock.current = false;
      setPending(false);
    }
  };

  const importReceipt = () => {
    if (!rawReceipt.trim() || !signature.trim()) {
      setErrorMessage("Provide the signed receipt and its public signature.");
      return;
    }
    void postAction({ action: "import", rawReceipt, signature: signature.trim() }, "");
  };

  const decide = () => {
    if (!data || !eligibleForDecision || selectedReceiptId == null) return;
    const cleanReason = reason.trim();
    if (cleanReason.length < 10 || cleanReason.length > 2000) {
      setErrorMessage("The decision reason must be between 10 and 2,000 characters.");
      return;
    }
    decisionIdRef.current ||= crypto.randomUUID();
    void postAction({
      action: "decide",
      receiptId: selectedReceiptId,
      decisionId: decisionIdRef.current,
      reason: cleanReason,
      expectedAttempt: data.attempt ?? "",
      expectedStatus: data.status,
      expectedUpdatedAt: data.updatedAt,
    }, "", true);
  };

  const runLiveCheck = () => {
    if (!data?.canLiveCheck || !data.receiverOrigin || !liveConfirmed) return;
    void postAction({
      action: "check",
      authorizeLiveRead: true,
      receiverOrigin: data.receiverOrigin,
    }, "");
  };

  const createReplacement = () => {
    if (!data?.decision?.decisionId || data.decision.outcome !== "not_accepted" || data.replacementJobId != null) return;
    void postAction({ action: "replacement", decisionId: data.decision.decisionId }, "");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setErrorMessage(""); setOpen(true); }}
            aria-label={`Review reconciliation for publishing job ${job.id}`}
            data-testid={`button-reconcile-${job.id}`}
          >
            <FileCheck2 className="mr-1.5 h-4 w-4" />
            Reconcile
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Operator reconciliation</DialogTitle>
            <DialogDescription>
              Review signed receiver evidence for job {job.publicId}. A replacement is a new publishing operation; it never resets this job.
            </DialogDescription>
          </DialogHeader>

          {reconciliationQuery.isLoading ? (
            <div className="space-y-3 py-4" aria-label="Loading reconciliation details">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-16 animate-pulse rounded bg-muted" />
              <div className="h-24 animate-pulse rounded bg-muted" />
            </div>
          ) : reconciliationQuery.isError ? (
            <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-4" role="alert">
              <p className="text-sm text-destructive">{(reconciliationQuery.error as Error).message}</p>
              <Button variant="outline" size="sm" onClick={() => reconciliationQuery.refetch()} disabled={pending}>Retry loading</Button>
            </div>
          ) : data ? (
            <div className="space-y-5">
              <section className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-2" aria-label="Preserved job attempt">
                <div><span className="text-muted-foreground">Job status</span><p className="font-medium">{data.status.replaceAll("_", " ")}</p></div>
                <div><span className="text-muted-foreground">Preserved attempt</span><p className="font-mono text-xs">{data.attempt ?? "Not recorded"}</p></div>
                <div><span className="text-muted-foreground">Last updated</span><p>{readableDate(data.updatedAt)}</p></div>
                <div><span className="text-muted-foreground">Receiver origin</span><p className="break-all">{data.receiverOrigin || "Not available"}</p></div>
                {data.legacy && <p className="flex gap-2 text-amber-800 dark:text-amber-300 sm:col-span-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Legacy jobs cannot be retried or adjudicated using this workflow.</p>}
              </section>

              {!data.legacy && (
                <section className="space-y-3 rounded-md border p-3" aria-labelledby={`import-heading-${job.id}`}>
                  <h3 id={`import-heading-${job.id}`} className="font-semibold">Import signed receiver receipt</h3>
                  <p className="text-sm text-muted-foreground">Paste the exact native receipt and its public signature. This records evidence only; it does not publish, retry, or record a decision. Never enter an API key.</p>
                  <label htmlFor={`receipt-body-${job.id}`} className="block text-sm font-medium">Native receipt JSON</label>
                  <textarea id={`receipt-body-${job.id}`} value={rawReceipt} onChange={(event) => setRawReceipt(event.target.value)}
                    maxLength={32768} rows={4} disabled={pending} spellCheck={false}
                    className="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  <label htmlFor={`receipt-signature-${job.id}`} className="block text-sm font-medium">Public receipt signature</label>
                  <input id={`receipt-signature-${job.id}`} value={signature} onChange={(event) => setSignature(event.target.value)}
                    maxLength={64} disabled={pending} autoComplete="off" spellCheck={false}
                    className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  <Button type="button" variant="outline" onClick={importReceipt} disabled={pending || !rawReceipt.trim() || !/^[a-f0-9]{64}$/.test(signature.trim())}>Import signed receipt</Button>
                </section>
              )}
              {data.conflict && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Conflicting receiver evidence requires investigation. The recorded decision remains in the audit history; no replacement can be authorized.</p>}
              <section className="space-y-3" aria-labelledby={`receipts-heading-${job.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 id={`receipts-heading-${job.id}`} className="font-semibold">Receipt provenance</h3>
                  <Badge variant="outline">{data.receipts.length} receipt{data.receipts.length === 1 ? "" : "s"}</Badge>
                </div>
                {data.receipts.length ? (
                  <div className="space-y-2">
                    {data.receipts.map((receipt) => (
                      <label key={receipt.id} className={`block rounded-md border p-3 ${eligibleForDecision ? "cursor-pointer" : ""}`}>
                        <span className="flex items-start gap-3">
                          <input
                            type="radio"
                            name={`receipt-${job.id}`}
                            className="mt-1 accent-primary"
                            checked={selectedReceiptId === receipt.id}
                            onChange={() => setSelectedReceiptId(receipt.id)}
                            disabled={!eligibleForDecision || pending}
                            aria-label={`Select receipt ${receipt.receiptId}, outcome ${outcomeLabel(receipt.outcome)}`}
                          />
                          <span className="min-w-0 flex-1 space-y-1 text-sm">
                            <span className="flex flex-wrap items-center gap-2 font-medium">
                              {outcomeLabel(receipt.outcome)}
                              <Badge variant="secondary" className="font-normal">{receipt.source}</Badge>
                            </span>
                            <span className="block break-all text-xs text-muted-foreground">Receipt {receipt.receiptId} · observed {readableDate(receipt.observedAt)}</span>
                            <span className="block break-all font-mono text-[11px] text-muted-foreground">Digest: {receipt.digest}</span>
                            <span className="block text-xs text-muted-foreground">Recorded {readableDate(receipt.at)} · operator {receipt.actorId}</span>
                            {receipt.pageUrl && <a href={receipt.pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline" onClick={(event) => event.stopPropagation()}>Evidence page <ExternalLink className="h-3 w-3" /></a>}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No receipt evidence is recorded. A negative callback or a not-found response is not proof that publishing did not occur.</p>}
              </section>

              {data.canLiveCheck && data.receiverOrigin ? (
                <section className="space-y-2 rounded-md border p-3">
                  <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" />Read-only receiver check</h3>
                  <p className="text-sm text-muted-foreground">A live read is optional and will never run automatically. It checks the displayed receiver only; a negative callback or not-found response is not proof of non-acceptance.</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => { setLiveConfirmed(false); setLiveDialogOpen(true); }} disabled={pending}>
                    Confirm live read…
                  </Button>
                </section>
              ) : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Read-only receiver check unavailable for this job. A bound original receiver with native receipt support is required. No live request will be made.</p>}

              {eligibleForDecision ? (
                <section className="space-y-3 rounded-md border p-3" aria-labelledby={`decision-heading-${job.id}`}>
                  <h3 id={`decision-heading-${job.id}`} className="font-semibold">Record operator decision</h3>
                  <p className="text-sm text-muted-foreground">Choose the receipt to review. The server derives the decision outcome from that evidence. “Proven not accepted” requires a signed, irrevocable fence.</p>
                  <div className="space-y-2">
                    <label htmlFor={`decision-reason-${job.id}`} className="text-sm font-medium">Reason</label>
                    <textarea
                      id={`decision-reason-${job.id}`}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      maxLength={2000}
                      rows={4}
                      disabled={pending}
                      aria-describedby={`decision-reason-help-${job.id}`}
                      className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="Explain which evidence supports this decision."
                    />
                    <p id={`decision-reason-help-${job.id}`} className="text-xs text-muted-foreground">{reason.trim().length}/2,000 characters · minimum 10</p>
                  </div>
                  <Button onClick={decide} disabled={pending || selectedReceiptId == null || reason.trim().length < 10}>
                    {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    Record decision
                  </Button>
                </section>
              ) : (
                <p className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
                  {data.legacy
                    ? "Legacy jobs cannot be adjudicated or retried."
                    : !["outcome_unknown", "processing", "sent"].includes(data.status)
                      ? "Adjudication is available only while the publishing outcome is unresolved."
                      : "Add signed receipt evidence before recording a decision."}
                </p>
              )}

              {data.decision && (
                <section className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3" aria-labelledby={`decision-record-${job.id}`}>
                  <h3 id={`decision-record-${job.id}`} className="font-semibold">Recorded decision</h3>
                  <div><Badge>{outcomeLabel(data.decision.outcome)}</Badge></div>
                  <p className="whitespace-pre-wrap text-sm">{data.decision.reason}</p>
                  <p className="text-xs text-muted-foreground">Receipt {data.decision.receiptId} · decision {data.decision.decisionId} · operator {data.decision.actorId} · {readableDate(data.decision.at)}</p>
                </section>
              )}

              {data.decision?.outcome === "not_accepted" && !data.conflict && data.replacementJobId == null && (
                <section className="space-y-2 rounded-md border p-3">
                  <h3 className="font-semibold">Replacement operation</h3>
                  <p className="text-sm text-muted-foreground">This explicitly starts a new publishing operation. The original attempt and evidence remain unchanged.</p>
                  <Button variant="outline" onClick={() => setReplacementDialogOpen(true)} disabled={pending}>Authorize new publishing operation</Button>
                </section>
              )}
              {data.replacementJobId != null && (
                <section className="rounded-md border p-3 text-sm">
                  <h3 className="font-semibold">Replacement operation</h3>
                  <p className="mt-1 text-muted-foreground">New job #{data.replacementJobId}. The original attempt remains preserved.</p>
                </section>
              )}

              <section className="space-y-2" aria-labelledby={`audit-heading-${job.id}`}>
                <h3 id={`audit-heading-${job.id}`} className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4" />Audit history</h3>
                {data.audit.length ? (
                  <ol className="space-y-2 border-l pl-4">
                    {data.audit.map((entry, index) => (
                      <li key={`${entry.at}-${entry.action}-${index}`} className="relative text-sm before:absolute before:-left-[21px] before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-muted-foreground">
                        <p className="font-medium">{entry.action.replaceAll("_", " ")}</p>
                        <p className="text-xs text-muted-foreground">{readableDate(entry.at)} · operator {entry.actorId}{entry.reason ? ` · ${entry.reason}` : ""}</p>
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-muted-foreground">No reconciliation actions have been recorded.</p>}
              </section>
            </div>
          ) : null}

          {errorMessage && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorMessage}</p>}
          {pending && <p className="sr-only" aria-live="polite">Saving reconciliation update…</p>}
        </DialogContent>
      </Dialog>

      <AlertDialog open={liveDialogOpen} onOpenChange={(next) => { if (!pending) setLiveDialogOpen(next); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Authorize a read-only live check?</AlertDialogTitle>
            <AlertDialogDescription>
              This sends a one-time read-only check to <strong className="break-all">{data?.receiverOrigin}</strong>. No publishing or write operation will be performed. A negative result is not proof of non-acceptance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={liveConfirmed} onCheckedChange={(checked) => setLiveConfirmed(checked === true)} disabled={pending} />
            <span>I explicitly authorize this read-only live access to the receiver origin shown above.</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); runLiveCheck(); }} disabled={!liveConfirmed || pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Run one-time check
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={replacementDialogOpen} onOpenChange={(next) => { if (!pending) setReplacementDialogOpen(next); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start a new publishing operation?</AlertDialogTitle>
            <AlertDialogDescription>
              This authorizes a new job based on the recorded proven-not-accepted decision. It does not reset, retry, or alter the original attempt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); createReplacement(); }} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Authorize new operation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
