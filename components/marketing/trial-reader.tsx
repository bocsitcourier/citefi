"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-mark";
import { useAuth } from "@/lib/auth-context";
import { TrialInput, TrialView, trialInputSchema } from "@/lib/trial/contracts";
import { claimTrial, exportTrial, generateTrial, getTrial, prepareTrialForGeneration } from "@/lib/trial/client";
import { articleBriefPrefill } from "@/lib/marketing/solutions";
import { supportReferenceFromMessage } from "@/lib/trial/ui-errors";
import { ArrowRight, Check, Copy, Download, Loader2, Printer, RotateCw } from "lucide-react";

const initial: TrialInput = { topic: "", businessName: "", city: "", audience: "" };
type TrialField = keyof TrialInput;
const fieldLabels: Record<TrialField, string> = {
  businessName: "Business name",
  city: "City or service area",
  audience: "Who is it for?",
  topic: "Article topic",
};
export default function TrialReader() {
  const { user } = useAuth();
  const [trial, setTrial] = useState<TrialView | null>(null);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<TrialField, string>>>({});
  const [generationNeedsStatusCheck, setGenerationNeedsStatusCheck] = useState(false);
  const [copied, setCopied] = useState(false);
  const loading = useRef(false);
  const claiming = useRef(false);
  const generationInFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const [referenceCopied, setReferenceCopied] = useState(false);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    const context = articleBriefPrefill(window.location.search);
    setForm(current => ({ ...current, ...context }));
  }, []);
  const load = useCallback(async (manual = false) => {
    if (loading.current || generationInFlight.current || claiming.current) return;
    loading.current = true;
    setCheckingStatus(true);
    try {
      if (manual) setError("");
      const view = await getTrial();
      setTrial(view);
      // Losing the session isn't evidence that a previous submission stopped.
      if (view.status !== "empty") setGenerationNeedsStatusCheck(false);
    }
    catch (e) { setError(e instanceof Error ? e.message : "The article could not be loaded."); }
    finally { loading.current = false; setCheckingStatus(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (trial?.status !== "generating") return undefined;
    const timer = setInterval(() => { void load(); }, 2200);
    return () => clearInterval(timer);
  }, [trial?.status, load]);
  useEffect(() => {
    if (user?.accountStatus === "active" && trial?.status === "ready" && trial.access === "preview") {
      if (claiming.current) return;
      claiming.current = true;
      claimTrial().then(setTrial).catch((e) => setError(e instanceof Error ? e.message : "Could not connect this article to your account.")).finally(() => { claiming.current = false; });
    }
  }, [user?.accountStatus, trial?.status, trial?.access]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (generationInFlight.current || loading.current || busy) return;
    const parsed = trialInputSchema.safeParse(form);
    if (!parsed.success) {
      const nextErrors: Partial<Record<TrialField, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as TrialField;
        if (field in fieldLabels && !nextErrors[field]) {
          nextErrors[field] = `${fieldLabels[field]}: ${issue.message}`;
        }
      }
      setFieldErrors(nextErrors);
      setError("Please check the highlighted fields. Each field needs meaningful content within its length limit.");
      return;
    }
    setFieldErrors({});
    if (!trial || (trial.status !== "empty" && trial.status !== "created")) {
      setError("Check article status before starting a draft.");
      return;
    }
    if (generationNeedsStatusCheck) {
      setError("This request may already be processing. Check article status before creating another draft.");
      return;
    }
    generationInFlight.current = true;
    setBusy(true); setError("");
    let submitted = false;
    try {
      const session = trial.status === "empty" ? await prepareTrialForGeneration() : trial;
      setTrial(session);
      if (session.status !== "created") return;
      submitted = true;
      const view = await generateTrial(parsed.data);
      setTrial(view);
      setGenerationNeedsStatusCheck(false);
    }
    catch (e) {
      setGenerationNeedsStatusCheck(submitted);
      setError(e instanceof Error ? e.message : submitted
        ? "Generation did not complete. Check article status before trying again."
        : "Your private article session could not be opened. No article was requested.");
    }
    finally { generationInFlight.current = false; setBusy(false); }
  };
  const captureInvalidField = (event: FormEvent<HTMLFormElement>) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    const field = target.name as TrialField;
    if (field in fieldLabels) {
      setFieldErrors(current => ({ ...current, [field]: `${fieldLabels[field]} is required and must meet its length limit.` }));
    }
    setError("Please complete the highlighted fields using the length limits shown.");
  };
  const updateField = (field: TrialField, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
    setFieldErrors(current => ({ ...current, [field]: undefined }));
  };
  const copySupportReference = async () => {
    const reference = supportReferenceFromMessage(error);
    if (!reference) return;
    try {
      await navigator.clipboard.writeText(reference);
      setReferenceCopied(true);
      window.setTimeout(() => setReferenceCopied(false), 1800);
    } catch {
      setError(`${error} Select the support reference above and copy it manually.`);
    }
  };
  const exportText = async (kind: "copy" | "download") => {
    if (busy) return; setBusy(true); setError("");
    try {
      const result = await exportTrial();
      if (kind === "copy") { await navigator.clipboard.writeText(`${result.title}\n\n${result.text}`); setCopied(true); setTimeout(() => setCopied(false), 1800); }
      else { const blob = new Blob([`${result.title}\n\n${result.text}`], { type: "text/plain;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${result.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "citefi-article"}.txt`; a.click(); URL.revokeObjectURL(url); }
    } catch (e) { setError(e instanceof Error ? e.message : "Export is not available."); }
    finally { setBusy(false); }
  };
  const article = trial?.access === "paid" ? trial.text : trial?.access === "watermarked" ? trial.text : "";
  const currentStep = trial?.access === "paid" ? 4 : trial?.access === "watermarked" ? 3 : trial?.status === "ready" ? 2 : 1;
  return <main className="trial-page">
    <div className="trial-top"><Link href="/" className="trial-brand" aria-label="Citefi home"><BrandLogo decorative className="h-7 w-auto" /><span> / ONE ARTICLE</span></Link><Link href="/pricing">See plans <ArrowRight size={15} /></Link></div>
    <ol aria-label="Your article journey" className="mx-auto mb-8 flex max-w-5xl flex-wrap gap-x-6 gap-y-2 text-sm">
      {["Tell us about your business", "See your preview", "Sign up to read it all", "Choose paid access to reuse it"].map((step, index) =>
        <li key={step} aria-current={currentStep === index + 1 ? "step" : undefined} className={currentStep === index + 1 ? "font-semibold" : "opacity-65"}>
          <span aria-hidden="true">{index + 1}. </span>{step}
        </li>)}
    </ol>
    {error && <div ref={errorRef} tabIndex={-1} className="trial-error" role="alert">
      <p>{error}</p>
      {supportReferenceFromMessage(error) && <p className="trial-support-reference">
        Support reference: <code>{supportReferenceFromMessage(error)}</code>
        <button type="button" onClick={() => void copySupportReference()}>{referenceCopied ? "Copied" : "Copy reference"}</button>
      </p>}
      <button type="button" onClick={() => void load(true)} disabled={checkingStatus || busy}>
        {checkingStatus ? "Checking article status…" : "Check article status"}
      </button>
    </div>}
    <div className="trial-layout">
      <section className="trial-intro"><div className="eyebrow">Try it on your own business</div><h1>Your customers have questions.<br /><em>Start answering one.</em></h1><p>What do people ask before they call, book or buy? Give us that question and a little business context. See your article preview without an account or card; sign up to read the full draft with a watermark.</p><div className="trial-boundary"><Check size={18} /><span>One free article. Your business facts stay yours to review.</span></div></section>
      {(!trial || trial.status === "empty" || trial.status === "created") ? <section className="trial-form-wrap">
        <form className="trial-form" onSubmit={submit} onInvalidCapture={captureInvalidField}><div className="eyebrow">Set your brief</div><h2>What should we write about?</h2>
          {!trial && checkingStatus && <div className="trial-bootstrap-status" role="status" aria-live="polite"><div className="skeleton-line wide" /><p>Checking for an existing article. You can fill in your brief while we check.</p></div>}
          <label htmlFor="trial-business">Business name<input id="trial-business" name="businessName" required minLength={2} maxLength={100} aria-invalid={!!fieldErrors.businessName} aria-describedby={fieldErrors.businessName ? "trial-business-error" : "trial-business-help"} value={form.businessName} onChange={(e) => updateField("businessName", e.target.value)} placeholder="Your business" /></label>
          {fieldErrors.businessName ? <small id="trial-business-error" className="trial-field-error">{fieldErrors.businessName}</small> : <small id="trial-business-help" className="trial-field-help">2–100 characters</small>}
          <label htmlFor="trial-city">City or service area<input id="trial-city" name="city" required minLength={2} maxLength={100} aria-invalid={!!fieldErrors.city} aria-describedby={fieldErrors.city ? "trial-city-error" : "trial-city-help"} value={form.city} onChange={(e) => updateField("city", e.target.value)} placeholder="Where you work" /></label>
          {fieldErrors.city ? <small id="trial-city-error" className="trial-field-error">{fieldErrors.city}</small> : <small id="trial-city-help" className="trial-field-help">2–100 characters</small>}
          <label htmlFor="trial-audience">Who is it for?<input id="trial-audience" name="audience" required minLength={2} maxLength={160} aria-invalid={!!fieldErrors.audience} aria-describedby={fieldErrors.audience ? "trial-audience-error" : "trial-audience-help"} value={form.audience} onChange={(e) => updateField("audience", e.target.value)} placeholder="The people you serve" /></label>
          {fieldErrors.audience ? <small id="trial-audience-error" className="trial-field-error">{fieldErrors.audience}</small> : <small id="trial-audience-help" className="trial-field-help">2–160 characters</small>}
          <label htmlFor="trial-topic">Article topic<textarea id="trial-topic" name="topic" required minLength={8} maxLength={180} aria-invalid={!!fieldErrors.topic} aria-describedby={fieldErrors.topic ? "trial-topic-error" : "trial-topic-help"} value={form.topic} onChange={(e) => updateField("topic", e.target.value)} placeholder="A specific question or subject" rows={3} /></label>
          {fieldErrors.topic ? <small id="trial-topic-error" className="trial-field-error">{fieldErrors.topic}</small> : <small id="trial-topic-help" className="trial-field-help">8–180 characters</small>}
          <button className="trial-submit" disabled={busy || checkingStatus || generationNeedsStatusCheck || !trial}>{busy ? <><Loader2 className="animate-spin" size={17} /> Preparing your draft…</> : generationNeedsStatusCheck ? <>Check status before trying again <RotateCw size={16} /></> : <>Create my free article <ArrowRight size={17} /></>}</button><small>No sign-in or paid account is required to start. Nothing is published automatically.</small>
          {busy && <p role="status" aria-live="polite">Your request is running. Keep this page open; please don’t submit another request.</p>}
          {generationNeedsStatusCheck && <>
            <p className="trial-form-status" role="status">{trial?.status === "empty"
              ? "We couldn’t find the session for your previous request. Allow cookies and use the original browser to check its status. We won’t start another draft automatically."
              : "We have not confirmed whether the request completed. Check its status before any new submission."}</p>
            {!error && <button type="button" className="quiet-button" onClick={() => void load(true)} disabled={checkingStatus}>
              <RotateCw size={16} /> {checkingStatus ? "Checking article status…" : "Check article status"}
            </button>}
          </>}
        </form>
      </section> : null}
      {trial?.status === "generating" && <section className="trial-state"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-block" /><p><Loader2 className="animate-spin" size={17} /> Your article is being prepared. This page checks for the result automatically.</p></section>}
      {trial?.status === "uncertain" && <section className="trial-state uncertain"><div className="eyebrow">Completion unconfirmed</div><h2>We don’t have a confirmed result yet.</h2><p>{trial.message || "The request is retained for support. We will not charge a provider again automatically."}</p>{supportReferenceFromMessage(trial.message || "") && <p className="trial-support-reference">Support reference: <code>{supportReferenceFromMessage(trial.message || "")}</code></p>}<button className="quiet-button" onClick={() => void load(true)} disabled={checkingStatus}><RotateCw size={16} /> {checkingStatus ? "Checking status…" : "Check status"}</button></section>}
      {trial && trial.status === "ready" && <section className="trial-article">
        {trial.accountPending && <div className="pending-notice">Your account request is pending approval. This article remains available in the scoped trial reader; paid features still require approval and normal sign-in.</div>}
        <div className="article-label">{trial.access === "preview" ? "Excerpt · preview" : trial.access === "watermarked" ? "Full reading · watermark applied" : "Full article"}</div><h2>{trial.title || "Your article draft"}</h2>
        {trial.access === "preview" ? <><p>{trial.preview}</p><div className="article-lock"><b>That’s the preview.</b><span>Create an account to read the complete article with a visible watermark.</span><Link href="/signup?trial=1" className="trial-submit">Continue to signup <ArrowRight size={16} /></Link></div></> : <><div className={`article-body ${trial.access === "watermarked" ? "watermarked" : ""}`} tabIndex={trial.access === "watermarked" ? 0 : undefined} onCopy={trial.access === "watermarked" ? (event) => event.preventDefault() : undefined} onContextMenu={trial.access === "watermarked" ? (event) => event.preventDefault() : undefined} onKeyDown={trial.access === "watermarked" ? (event) => { if ((event.ctrlKey || event.metaKey) && ["c", "p", "s"].includes(event.key.toLowerCase())) event.preventDefault(); } : undefined}>{article?.split("\n").map((line, i) => line.trim() ? <p key={i}>{line}</p> : null)}</div>{trial.access === "watermarked" && <><div className="watermark-notice">Citefi trial reading · not for reuse. Copy, print, and download are unavailable until paid access.</div><p className="honest-notice">Screenshots cannot be prevented. A paid plan is required to copy or download this article.</p><div className="article-actions"><Link href="/pricing" className="trial-submit">View paid plans <ArrowRight size={16} /></Link></div></>}{trial.access === "paid" && <div className="article-actions"><button onClick={() => void exportText("copy")} disabled={busy}><Copy size={16} />{copied ? "Copied" : "Copy"}</button><button onClick={() => void exportText("download")} disabled={busy}><Download size={16} />Download</button><button onClick={async () => { if (busy) return; const w = window.open("", "_blank"); if (!w) { setError("Allow pop-ups to print this article."); return; } setBusy(true); setError(""); try { const x = await exportTrial(); w.document.write(`<title>${x.title.replace(/[<>]/g, "")}</title><h1>${x.title.replace(/[<>]/g, "")}</h1><pre style=\"white-space:pre-wrap;font:16px sans-serif\">${x.text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))}</pre>`); w.document.close(); w.print(); } catch(e) { w.close(); setError(e instanceof Error ? e.message : "Print is not available."); } finally { setBusy(false); } }} disabled={busy}><Printer size={16} />Print</button></div>}</>}
      </section>}
    </div>
    <footer className="trial-footer">Your article is a generated draft. Check facts and links before using it. Citefi does not promise search rankings or business outcomes. Before account approval, keep this browser: the private reading link lasts 30 days from starting the trial. After approval, sign in to recover your article on another device.</footer>
  </main>;
}
