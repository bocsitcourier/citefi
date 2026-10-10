"use client";
import { useId, useState } from "react";

const formats = ["Article", "Image brief", "Social draft", "Podcast outline", "Video storyboard"] as const;
export function CampaignExample({ question, business }: { question: string; business: string }) {
  const [selected, setSelected] = useState<(typeof formats)[number]>("Article");
  const id = useId();
  const outputs = {
    Article: ["Start with the decision the reader needs to make.", `Answer: ${question}`, "Explain the real options, preparation and business process.", "Close with the business's verified next step: call, book, visit or buy."],
    "Image brief": [`Create a clear visual supporting this question: ${question}`, `Use the actual brand direction for ${business}.`, "Show the relevant process or checklist without invented customer portraits.", "Review the visual and write a description of what it actually shows."],
    "Social draft": [`Before you decide: ${question}`, "Here are the details to check and the questions worth asking.", "Read the guide, then use our actual contact or booking channel when you are ready.", "Verify every offer, link and business detail before posting."],
    "Podcast outline": ["Open with the question customers keep asking.", "Explain the key options and preparation steps from the reviewed article.", "Use a short recap to help listeners remember the important decisions.", "End with the business's verified next step; review the generated audio before use."],
    "Video storyboard": ["Opening: put the customer's question on screen.", "Middle: explain one practical process or preparation checklist.", "Visual/narration: keep claims consistent with the reviewed business brief.", "Closing: show the real contact, booking or buying next step."],
  };
  return <section className="campaign-example">
    <div className="eyebrow">One message, several useful formats</div><h2>See how the work connects.</h2>
    <p className="section-intro">For {business}: <strong>{question}</strong> Choose only the formats that help this customer decide—not more content for its own sake.</p>
    <div className="format-tabs" role="tablist" aria-label="Illustrative campaign formats">{formats.map((format, index) => <button key={format} type="button" role="tab" id={`${id}-tab-${index}`} aria-selected={selected === format} aria-controls={`${id}-panel`} tabIndex={selected === format ? 0 : -1} onClick={() => setSelected(format)} onKeyDown={event => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? formats.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + formats.length) % formats.length;
      setSelected(formats[next]!);
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>{format}</button>)}</div>
    <div className="format-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${formats.indexOf(selected)}`} tabIndex={0}>
      <span className="eyebrow">{selected}</span><ol>{outputs[selected].map(line => <li key={line}>{line}</li>)}</ol>
    </div>
    <p className="example-disclosure">Illustrative planning example—not generated output, customer work, a published campaign or performance evidence. Image briefs/outlines here show direction, not finished media assets.</p>
  </section>;
}
