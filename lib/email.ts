/**
 * Email utility for Citefi.
 *
 * Delivery strategy (in priority order):
 * 1. SMTP via Nodemailer when SMTP_HOST + SMTP_USER + SMTP_PASS are set.
 * 2. Console-log fallback (matching the existing send-email-code pattern)
 *    so the app works without email credentials during development.
 *
 * Required env vars for real delivery:
 *   SMTP_HOST   — e.g. smtp.sendgrid.net
 *   SMTP_PORT   — defaults to 587
 *   SMTP_USER   — SMTP username
 *   SMTP_PASS   — SMTP password
 *   SMTP_FROM   — From address, e.g. "Citefi <noreply@example.com>"
 */

import nodemailer from "nodemailer";

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Escape characters that are dangerous inside HTML attribute values / text. */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTransport(): nodemailer.Transporter | null {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function deliverEmail(payload: EmailPayload): Promise<void> {
  const transport = buildTransport();

  if (transport) {
    const from =
      process.env.SMTP_FROM ?? "Citefi <noreply@example.com>";
    try {
      await transport.sendMail({
        from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });
      console.log(`📧 Email sent via SMTP to ${payload.to}: ${payload.subject}`);
    } catch (err) {
      console.error(`📧 SMTP delivery failed for ${payload.to}:`, err);
      throw err;
    }
  } else {
    // Development / no-SMTP fallback — log the full email body
    const border = "━".repeat(54);
    console.log(`
${border}
📧 EMAIL (console fallback — set SMTP_HOST/SMTP_USER/SMTP_PASS for real delivery)
${border}
To:      ${payload.to}
Subject: ${payload.subject}

${payload.text}
${border}
    `);
  }
}

/**
 * Send a "your account is pending review" email to a newly registered user.
 */
export async function sendPendingApprovalEmail(opts: {
  to: string;
  fullName?: string | null;
}): Promise<void> {
  const name = escapeHtml(opts.fullName ?? "there");
  const namePlain = opts.fullName ?? "there";

  await deliverEmail({
    to: opts.to,
    subject: "Your Citefi account is pending review",
    text: [
      `Hi ${namePlain},`,
      "",
      "Thanks for signing up for Citefi!",
      "",
      "Your account has been created and is currently pending review by our admin team.",
      "You will receive another email once your account has been approved and is ready to use.",
      "",
      "If you have any questions in the meantime, please reach out to support.",
      "",
      "— The Citefi Team",
    ].join("\n"),
    html: `
<p>Hi ${name},</p>
<p>Thanks for signing up for <strong>Citefi</strong>!</p>
<p>Your account has been created and is currently <strong>pending review</strong> by our admin team.
You will receive another email once your account has been approved and is ready to use.</p>
<p>If you have any questions in the meantime, please reach out to support.</p>
<p>— The Citefi Team</p>
    `.trim(),
  });
}

/**
 * Send an "your account has been approved" email to a user.
 */
export async function sendAccountApprovedEmail(opts: {
  to: string;
  fullName?: string | null;
}): Promise<void> {
  const name = escapeHtml(opts.fullName ?? "there");
  const namePlain = opts.fullName ?? "there";

  await deliverEmail({
    to: opts.to,
    subject: "Your Citefi account has been approved",
    text: [
      `Hi ${namePlain},`,
      "",
      "Great news — your Citefi account has been approved!",
      "",
      "You can now log in and start using the platform.",
      "",
      "— The Citefi Team",
    ].join("\n"),
    html: `
<p>Hi ${name},</p>
<p>Great news — your <strong>Citefi</strong> account has been <strong>approved</strong>!</p>
<p>You can now log in and start using the platform.</p>
<p>— The Citefi Team</p>
    `.trim(),
  });
}

/**
 * Send an "your account registration was not approved" email to a user.
 */
export async function sendAccountRejectedEmail(opts: {
  to: string;
  fullName?: string | null;
}): Promise<void> {
  const name = escapeHtml(opts.fullName ?? "there");
  const namePlain = opts.fullName ?? "there";

  await deliverEmail({
    to: opts.to,
    subject: "Your Citefi account registration",
    text: [
      `Hi ${namePlain},`,
      "",
      "Thank you for your interest in Citefi.",
      "",
      "After reviewing your registration, we are unable to approve your account at this time.",
      "",
      "If you believe this is an error or have any questions, please contact our support team.",
      "",
      "— The Citefi Team",
    ].join("\n"),
    html: `
<p>Hi ${name},</p>
<p>Thank you for your interest in <strong>Citefi</strong>.</p>
<p>After reviewing your registration, we are unable to approve your account at this time.</p>
<p>If you believe this is an error or have any questions, please contact our support team.</p>
<p>— The Citefi Team</p>
    `.trim(),
  });
}

/**
 * Mutable service object — lets tests replace individual methods via mock.method()
 * without needing ESM module-level mocking (unavailable in Node 20).
 * Route handlers call via emailService.sendAccount*Email(...) so the lookup
 * happens at call-time, making any property replacement on this object visible.
 */
export const emailService = {
  sendPendingApprovalEmail,
  sendAccountApprovedEmail,
  sendAccountRejectedEmail,
};

/**
 * Send a verification code email (login 2FA, email verification, password reset).
 */
export async function sendEmailVerificationCode(opts: {
  to: string;
  code: string;
  purpose: "login_2fa" | "email_verification" | "password_reset";
  fullName?: string | null;
}): Promise<void> {
  const namePlain = opts.fullName ?? "there";
  const name = escapeHtml(namePlain);

  const purposeLabels: Record<typeof opts.purpose, string> = {
    login_2fa: "sign in",
    email_verification: "verify your email address",
    password_reset: "reset your password",
  };
  const purposeLabel = purposeLabels[opts.purpose];

  await deliverEmail({
    to: opts.to,
    subject: `Your ApexContent Engine verification code`,
    text: [
      `Hi ${namePlain},`,
      "",
      `Your verification code to ${purposeLabel} is:`,
      "",
      `  ${opts.code}`,
      "",
      "This code expires in 10 minutes. If you did not request this code, you can safely ignore this email.",
      "",
      "— The ApexContent Engine Team",
    ].join("\n"),
    html: `
<p>Hi ${name},</p>
<p>Your verification code to <strong>${escapeHtml(purposeLabel)}</strong> is:</p>
<p style="font-size:2em;letter-spacing:0.3em;font-weight:bold;">${escapeHtml(opts.code)}</p>
<p>This code expires in <strong>10 minutes</strong>. If you did not request this code, you can safely ignore this email.</p>
<p>— The ApexContent Engine Team</p>
    `.trim(),
  });
}

/**
 * Send a new-signup notification to an admin user.
 * When approveUrl / rejectUrl are provided, one-click action buttons are
 * embedded directly in the email so the admin can act without logging in.
 */
export async function sendNewSignupAdminNotification(opts: {
  adminEmail: string;
  newUserEmail: string;
  newUserName?: string | null;
  teamName?: string | null;
  approveUrl?: string | null;
  rejectUrl?: string | null;
}): Promise<void> {
  const userNamePlain = opts.newUserName ?? "(no name provided)";
  const teamNamePlain = opts.teamName ?? "(no team name provided)";
  const userName = escapeHtml(userNamePlain);
  const teamName = escapeHtml(teamNamePlain);
  const userEmail = escapeHtml(opts.newUserEmail);

  const hasActionLinks = !!(opts.approveUrl && opts.rejectUrl);

  const textActionSection = hasActionLinks
    ? [
        "",
        "To approve this account, visit:",
        opts.approveUrl!,
        "",
        "To reject this account, visit:",
        opts.rejectUrl!,
        "",
        "These links expire in 7 days. You can also manage accounts via the admin panel.",
      ].join("\n")
    : [
        "",
        "Please log in to the admin panel to review and approve or reject this account.",
      ].join("\n");

  const htmlActionSection = hasActionLinks
    ? `
<p style="margin-top:1.5em;">
  <a href="${escapeHtml(opts.approveUrl!)}" style="display:inline-block;padding:10px 22px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;margin-right:10px;">
    Approve Account
  </a>
  <a href="${escapeHtml(opts.rejectUrl!)}" style="display:inline-block;padding:10px 22px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
    Reject Account
  </a>
</p>
<p style="font-size:0.85em;color:#6b7280;margin-top:0.75em;">
  These links expire in 7 days. You can also manage accounts via the admin panel.
</p>`
    : `<p>Please log in to the <strong>admin panel</strong> to review and approve or reject this account.</p>`;

  await deliverEmail({
    to: opts.adminEmail,
    subject: "New user registration pending approval",
    text: [
      "A new user has registered and is awaiting account approval.",
      "",
      `Name:  ${userNamePlain}`,
      `Email: ${opts.newUserEmail}`,
      `Team:  ${teamNamePlain}`,
      textActionSection,
      "",
      "— Citefi",
    ].join("\n"),
    html: `
<p>A new user has registered and is awaiting account approval.</p>
<table cellpadding="4">
  <tr><td><strong>Name</strong></td><td>${userName}</td></tr>
  <tr><td><strong>Email</strong></td><td>${userEmail}</td></tr>
  <tr><td><strong>Team</strong></td><td>${teamName}</td></tr>
</table>
${htmlActionSection}
<p>— Citefi</p>
    `.trim(),
  });
}

/**
 * Send the daily marketing brief email to a user.
 */
export async function sendDailyBriefEmail(opts: {
  to: string;
  fullName?: string | null;
  brief: {
    todayFocus: { type: string; action: string; why: string; ctaPath: string };
    overnightMovement: { headline: string; items: string[] };
    competitorWatch: { headline: string; insights: string[] };
    teachingMoment: { lesson: string; groundedIn: string };
    voicePrompt: { nudge: string };
    motivation: { headline: string; evidence: string[] };
  };
  appUrl: string;
  localDate: string;
}): Promise<void> {
  const namePlain = opts.fullName ?? "there";
  const name = escapeHtml(namePlain);
  const brief = opts.brief;
  const viewUrl = `${opts.appUrl}${brief.todayFocus.ctaPath}`;

  const text = [
    `Your Marketing Brief – ${opts.localDate}`,
    "",
    `Hi ${namePlain},`,
    "",
    "TODAY'S FOCUS",
    `Action: ${brief.todayFocus.action}`,
    `Why: ${brief.todayFocus.why}`,
    `View in Citefi: ${viewUrl}`,
    "",
    `OVERNIGHT MOVEMENT: ${brief.overnightMovement.headline}`,
    ...brief.overnightMovement.items.map((item) => `- ${item}`),
    "",
    `COMPETITOR WATCH: ${brief.competitorWatch.headline}`,
    ...brief.competitorWatch.insights.map((item) => `- ${item}`),
    "",
    "TEACHING MOMENT",
    brief.teachingMoment.lesson,
    `Grounded in: ${brief.teachingMoment.groundedIn}`,
    "",
    "VOICE PROMPT",
    brief.voicePrompt.nudge,
    "",
    `MOTIVATION: ${brief.motivation.headline}`,
    ...brief.motivation.evidence.map((item) => `- ${item}`),
    "",
    "— The Citefi Team",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1f2937; background-color: #f9fafb; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb; }
    .header { background-color: #f3f4f6; padding: 20px; border-bottom: 1px solid #e5e7eb; }
    .content { padding: 24px; }
    .hero-box { background-color: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
    .hero-title { color: #0f766e; font-weight: 700; font-size: 1.125rem; margin: 0 0 8px 0; }
    .section-title { font-weight: 700; font-size: 0.875rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; margin-top: 24px; }
    .cta-button { display: inline-block; background-color: #0d9488; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 16px; }
    .footer { padding: 20px; font-size: 0.75rem; color: #9ca3af; text-align: center; }
    ul { padding-left: 20px; margin: 8px 0; }
    li { margin-bottom: 4px; }
    p { margin: 8px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin:0; font-size: 1.25rem;">Your Marketing Brief &ndash; ${escapeHtml(opts.localDate)}</h1>
    </div>
    <div class="content">
      <p>Hi ${name},</p>
      
      <div class="hero-box">
        <h2 class="hero-title">TODAY'S FOCUS</h2>
        <p><strong>${escapeHtml(brief.todayFocus.action)}</strong></p>
        <p style="font-size: 0.875rem; color: #374151;">${escapeHtml(brief.todayFocus.why)}</p>
        <a href="${escapeHtml(viewUrl)}" class="cta-button">View in Citefi</a>
      </div>

      <div class="section-title">Overnight Movement</div>
      <p><strong>${escapeHtml(brief.overnightMovement.headline)}</strong></p>
      <ul>
        ${brief.overnightMovement.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}
      </ul>

      <div class="section-title">Competitor Watch</div>
      <p><strong>${escapeHtml(brief.competitorWatch.headline)}</strong></p>
      <ul>
        ${brief.competitorWatch.insights.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}
      </ul>

      <div class="section-title">Teaching Moment</div>
      <p>${escapeHtml(brief.teachingMoment.lesson)}</p>
      <p style="font-size: 0.875rem; font-style: italic;">Grounded in: ${escapeHtml(brief.teachingMoment.groundedIn)}</p>

      <div class="section-title">Voice Prompt</div>
      <p>${escapeHtml(brief.voicePrompt.nudge)}</p>

      <div class="section-title">Motivation</div>
      <p><strong>${escapeHtml(brief.motivation.headline)}</strong></p>
      <ul>
        ${brief.motivation.evidence.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}
      </ul>
    </div>
    <div class="footer">
      <p>&mdash; The Citefi Team</p>
      <p><a href="${escapeHtml(opts.appUrl)}/settings/brief" style="color: #9ca3af; text-decoration: underline;">Manage preferences</a></p>
    </div>
  </div>
</body>
</html>
  `.trim();

  await deliverEmail({
    to: opts.to,
    subject: `Your Marketing Brief – ${opts.localDate}`,
    text,
    html,
  });
}
