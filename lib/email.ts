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

async function deliverEmail(payload: EmailPayload): Promise<void> {
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
 */
export async function sendNewSignupAdminNotification(opts: {
  adminEmail: string;
  newUserEmail: string;
  newUserName?: string | null;
  teamName?: string | null;
}): Promise<void> {
  const userNamePlain = opts.newUserName ?? "(no name provided)";
  const teamNamePlain = opts.teamName ?? "(no team name provided)";
  const userName = escapeHtml(userNamePlain);
  const teamName = escapeHtml(teamNamePlain);
  const userEmail = escapeHtml(opts.newUserEmail);

  await deliverEmail({
    to: opts.adminEmail,
    subject: "New user registration pending approval",
    text: [
      "A new user has registered and is awaiting account approval.",
      "",
      `Name:  ${userNamePlain}`,
      `Email: ${opts.newUserEmail}`,
      `Team:  ${teamNamePlain}`,
      "",
      "Please log in to the admin panel to review and approve or reject this account.",
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
<p>Please log in to the <strong>admin panel</strong> to review and approve or reject this account.</p>
<p>— Citefi</p>
    `.trim(),
  });
}
