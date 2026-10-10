"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-mark";
import { useAuth } from "@/lib/auth-context";
import { TrialInput, TrialView } from "@/lib/trial/contracts";
import { claimTrial, exportTrial, generateTrial, getTrial, startTrial } from "@/lib/trial/client";
import { articleBriefPrefill } from "@/lib/marketing/solutions";
import { ArrowRight, Check, Copy, Download, Loader2, Printer, RotateCw } from "lucide-react";

const initial: TrialInput = { topic: "", businessName: "", city: "", audience: "" };
export default function TrialReader() {
  const { user } = useAuth();
  const [trial, setTrial] = useState<TrialView | null>(null);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loading = useRef(false);
  const claiming = useRef(false);
  useEffect(() => {
    const context = articleBriefPrefill(window.location.search);
    setForm(current => ({ ...current, ...context }));
  }, []);
  const load = useCallback(async (start = false) => {
    if (loading.current) return;
    loading.current = true;
    try {
      setError("");
      const view = start ? await startTrial() : await getTrial();
      setTrial(!start && view.status === "empty" ? await startTrial() : view);
    }
    catch (e) { setError(e instanceof Error ? e.message : "The article could not be loaded."); }
    finally { loading.current = false; setInitialized(true); }
  }, []);
  useEffect(() => { void load(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [load]);
  useEffect(() => {
    if (trial?.status !== "generating") return undefined;
    timer.current = setInterval(() => { void load(); }, 2200);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [trial?.status, load]);
  useEffect(() => {
    if (user?.accountStatus === "active" && trial?.access === "preview") {
      if (claiming.current) return;
      claiming.current = true;
      claimTrial().then(setTrial).catch((e) => setError(e instanceof Error ? e.message : "Could not connect this article to your account.")).finally(() => { claiming.current = false; });
    }
  }, [user?.accountStatus, trial?.access]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try { const view = await generateTrial(form); setTrial(view); }
    catch (e) { setError(e instanceof Error ? e.message : "Generation did not complete."); }
    finally { setBusy(false); }
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
    <div className="trial-layout">
      <section className="trial-intro"><div className="eyebrow">Try it on your own business</div><h1>Your customers have questions.<br /><em>Start answering one.</em></h1><p>What do people ask before they call, book or buy? Give us that question and a little business context. See your article preview without an account or card; sign up to read the full draft with a watermark.</p><div className="trial-boundary"><Check size={18} /><span>One free article. Your business facts stay yours to review.</span></div></section>
      {!initialized && <section className="trial-form-wrap"><div className="trial-state" aria-label="Loading article workspace"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-block" /></div></section>}
      {initialized && (!trial || trial.status === "empty" || trial.status === "created") ? <section className="trial-form-wrap">
        <form className="trial-form" onSubmit={submit}><div className="eyebrow">Set your brief</div><h2>What should we write about?</h2>
          <label>Business name<input required minLength={2} maxLength={100} value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="Your business" /></label>
          <label>City or service area<input required minLength={2} maxLength={100} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Where you work" /></label>
          <label>Who is it for?<input required minLength={2} maxLength={160} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="The people you serve" /></label>
          <label>Article topic<textarea required minLength={8} maxLength={180} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="A specific question or subject" rows={3} /></label>
          <button className="trial-submit" disabled={busy}>{busy ? <><Loader2 className="animate-spin" size={17} /> Preparing your draft…</> : <>Create my free article <ArrowRight size={17} /></>}</button><small>Review these details before you start. Nothing is published automatically.</small>
        </form>
      </section> : null}
      {trial?.status === "generating" && <section className="trial-state"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-block" /><p><Loader2 className="animate-spin" size={17} /> Your article is being prepared. This page checks for the result automatically.</p></section>}
      {trial?.status === "uncertain" && <section className="trial-state uncertain"><div className="eyebrow">Completion unconfirmed</div><h2>We don’t have a confirmed result yet.</h2><p>{trial.message || "The request is retained for support. We will not charge a provider again automatically."}</p><button className="quiet-button" onClick={() => void load()}><RotateCw size={16} /> Check status</button></section>}
      {trial && trial.status === "ready" && <section className="trial-article">
        {trial.accountPending && <div className="pending-notice">Your account request is pending approval. This article remains available in the scoped trial reader; paid features still require approval and normal sign-in.</div>}
        <div className="article-label">{trial.access === "preview" ? "Excerpt · preview" : trial.access === "watermarked" ? "Full reading · watermark applied" : "Full article"}</div><h2>{trial.title || "Your article draft"}</h2>
        {trial.access === "preview" ? <><p>{trial.preview}</p><div className="article-lock"><b>That’s the preview.</b><span>Create an account to read the complete article with a visible watermark.</span><Link href="/signup?trial=1" className="trial-submit">Continue to signup <ArrowRight size={16} /></Link></div></> : <><div className={`article-body ${trial.access === "watermarked" ? "watermarked" : ""}`} tabIndex={trial.access === "watermarked" ? 0 : undefined} onCopy={trial.access === "watermarked" ? (event) => event.preventDefault() : undefined} onContextMenu={trial.access === "watermarked" ? (event) => event.preventDefault() : undefined} onKeyDown={trial.access === "watermarked" ? (event) => { if ((event.ctrlKey || event.metaKey) && ["c", "p", "s"].includes(event.key.toLowerCase())) event.preventDefault(); } : undefined}>{article?.split("\n").map((line, i) => line.trim() ? <p key={i}>{line}</p> : null)}</div>{trial.access === "watermarked" && <><div className="watermark-notice">Citefi trial reading · not for reuse. Copy, print, and download are unavailable until paid access.</div><p className="honest-notice">Screenshots cannot be prevented. A paid plan is required to copy or download this article.</p><div className="article-actions"><Link href="/pricing" className="trial-submit">View paid plans <ArrowRight size={16} /></Link></div></>}{trial.access === "paid" && <div className="article-actions"><button onClick={() => void exportText("copy")} disabled={busy}><Copy size={16} />{copied ? "Copied" : "Copy"}</button><button onClick={() => void exportText("download")} disabled={busy}><Download size={16} />Download</button><button onClick={async () => { if (busy) return; const w = window.open("", "_blank"); if (!w) { setError("Allow pop-ups to print this article."); return; } setBusy(true); setError(""); try { const x = await exportTrial(); w.document.write(`<title>${x.title.replace(/[<>]/g, "")}</title><h1>${x.title.replace(/[<>]/g, "")}</h1><pre style=\"white-space:pre-wrap;font:16px sans-serif\">${x.text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))}</pre>`); w.document.close(); w.print(); } catch(e) { w.close(); setError(e instanceof Error ? e.message : "Print is not available."); } finally { setBusy(false); } }} disabled={busy}><Printer size={16} />Print</button></div>}</>}
      </section>}
    </div>
    {error && <div className="trial-error" role="alert">{error} <button onClick={() => void load()}>Try again</button></div>}
    <footer className="trial-footer">Your article is a generated draft. Check facts and links before using it. Citefi does not promise search rankings or business outcomes. Before account approval, keep this browser: the private reading link lasts 30 days from starting the trial. After approval, sign in to recover your article on another device.</footer>
  </main>;
}
