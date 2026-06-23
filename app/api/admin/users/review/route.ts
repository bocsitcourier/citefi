/**
 * GET  /api/admin/users/review?token=<signed-token>
 *   → Shows a confirmation page. Safe for email link-preview bots — no mutation.
 *
 * POST /api/admin/users/review
 *   → Reads `token` from form body, performs the approve/reject action atomically.
 *
 * Why split into GET/POST:
 *   Email security scanners and link-preview bots auto-fetch any URL in an email.
 *   A GET that mutates state would approve/reject accounts without admin intent.
 *   The POST is triggered only by an explicit button click on the confirmation page.
 *
 * Why the atomic WHERE guard on POST:
 *   Multiple bots or double-clicks could both pass a pre-check then race to update.
 *   Adding `AND accountStatus='pending_approval'` to the UPDATE's WHERE ensures only
 *   one concurrent request will affect a row; 0 rows updated means already actioned.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, sessions, activityLogs } from "@/shared/schema";
import { verifyApprovalToken } from "@/lib/approval-token";
import { and, eq, sql } from "drizzle-orm";
import {
  sendAccountApprovedEmail,
  sendAccountRejectedEmail,
} from "@/lib/email";

/** Escape characters that are dangerous inside HTML text nodes and attribute values. */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a standalone styled page.
 * heading and body are treated as pre-validated HTML — callers must escape any
 * user-controlled data (e.g. email) with escapeHtml() before passing it in.
 */
function htmlPage(title: string, heading: string, body: string, success: boolean): NextResponse {
  const safeTitle = escapeHtml(title);
  const color = success ? "#16a34a" : "#dc2626";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${safeTitle} — Citefi</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1.5rem}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:2.5rem 2rem;max-width:500px;width:100%;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)}
    .icon{font-size:3rem;margin-bottom:1rem}
    h1{font-size:1.4rem;font-weight:700;color:#111827;margin-bottom:.75rem}
    p{color:#6b7280;line-height:1.6;margin-bottom:.5rem}
    .status{display:inline-block;margin-top:1.25rem;padding:.4rem .9rem;border-radius:999px;font-size:.85rem;font-weight:600;background:${color}1a;color:${color}}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? "&#10003;" : "&#10007;"}</div>
    <h1>${heading}</h1>
    ${body}
    <br/>
    <span class="status">${safeTitle}</span>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status: success ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Render a confirmation page with Approve / Reject buttons.
 * No state mutation — safe for email link-preview bots.
 */
function confirmationPage(
  token: string,
  action: "approve" | "reject",
  userEmail: string,
): NextResponse {
  const safeToken = escapeHtml(token);
  const safeEmail = escapeHtml(userEmail);
  const isApprove = action === "approve";
  const verb = isApprove ? "Approve" : "Reject";
  const color = isApprove ? "#16a34a" : "#dc2626";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Confirm ${verb} — Citefi</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1.5rem}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:2.5rem 2rem;max-width:500px;width:100%;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)}
    h1{font-size:1.4rem;font-weight:700;color:#111827;margin-bottom:.75rem}
    p{color:#6b7280;line-height:1.6;margin-bottom:1.5rem}
    .email{font-weight:600;color:#374151}
    form{display:inline}
    .btn{display:inline-block;padding:10px 28px;border:none;border-radius:6px;font-size:1rem;font-weight:600;cursor:pointer;color:#fff;background:${color};margin:.25rem}
    .btn-ghost{background:#f3f4f6;color:#374151}
    .note{font-size:.8rem;color:#9ca3af;margin-top:1rem}
  </style>
</head>
<body>
  <div class="card">
    <h1>Confirm: ${verb} Account</h1>
    <p>You are about to <strong>${verb.toLowerCase()}</strong> the account for:<br/>
    <span class="email">${safeEmail}</span></p>
    <form method="POST" action="/api/admin/users/review">
      <input type="hidden" name="token" value="${safeToken}"/>
      <button type="submit" class="btn">${verb} Account</button>
    </form>
    <p class="note">This link expires in 7 days. You can also manage accounts from the admin panel.</p>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ─── GET: confirmation page (read-only, safe for crawlers) ──────────────────

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return htmlPage(
      "Missing token",
      "Invalid link",
      "<p>This link is missing required information. Please use the link from your notification email.</p>",
      false
    );
  }

  let payload: { userId: number; action: "approve" | "reject"; exp: number };
  try {
    payload = verifyApprovalToken(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const isExpired = msg.includes("expired");
    return htmlPage(
      isExpired ? "Link expired" : "Invalid link",
      isExpired ? "This link has expired" : "Invalid approval link",
      isExpired
        ? "<p>Approval links are valid for 7 days. Please log in to the admin panel to review this account.</p>"
        : "<p>This link is invalid or has been tampered with. Please use the link from your original notification email.</p>",
      false
    );
  }

  const { userId, action } = payload;

  const [user] = await db
    .select({ email: users.email, accountStatus: users.accountStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return htmlPage(
      "User not found",
      "Account not found",
      "<p>The account associated with this link no longer exists.</p>",
      false
    );
  }

  if (user.accountStatus !== "pending_approval") {
    const safeEmail = escapeHtml(user.email);
    const safeStatus =
      user.accountStatus === "active"
        ? "already approved"
        : user.accountStatus === "suspended"
        ? "already rejected"
        : escapeHtml(`in status: ${user.accountStatus}`);
    return htmlPage(
      "Already actioned",
      "This account has already been reviewed",
      `<p>The account for <strong>${safeEmail}</strong> is ${safeStatus}. No further action is needed.</p>`,
      true
    );
  }

  return confirmationPage(token, action, user.email);
}

// ─── POST: perform the action (only reachable by explicit button click) ──────

export async function POST(req: NextRequest) {
  let token: string | null = null;

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = await req.text();
      const params = new URLSearchParams(body);
      token = params.get("token");
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      token = body.token ?? null;
    }
  } catch {
    // malformed body — handled below
  }

  if (!token) {
    return htmlPage(
      "Missing token",
      "Invalid request",
      "<p>No approval token was provided. Please use the button in your notification email.</p>",
      false
    );
  }

  let payload: { userId: number; action: "approve" | "reject"; exp: number };
  try {
    payload = verifyApprovalToken(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const isExpired = msg.includes("expired");
    return htmlPage(
      isExpired ? "Link expired" : "Invalid link",
      isExpired ? "This link has expired" : "Invalid approval link",
      isExpired
        ? "<p>Approval links are valid for 7 days. Please log in to the admin panel to review this account.</p>"
        : "<p>This link is invalid or has been tampered with.</p>",
      false
    );
  }

  const { userId, action } = payload;

  // Fetch user details needed for follow-up email and audit log
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return htmlPage(
      "User not found",
      "Account not found",
      "<p>The account associated with this link no longer exists.</p>",
      false
    );
  }

  const safeEmail = escapeHtml(user.email);

  if (action === "approve") {
    // Atomic update: only succeeds if account is still pending_approval.
    // This prevents race conditions (e.g. two concurrent bot fetches) from
    // applying a double-action.
    const result = await db
      .update(users)
      .set({ accountStatus: "active", emailVerified: 1 })
      .where(and(eq(users.id, userId), eq(users.accountStatus, "pending_approval")))
      .returning({ id: users.id });

    if (result.length === 0) {
      // Another request (or an admin via the panel) already actioned this account
      return htmlPage(
        "Already actioned",
        "Account already reviewed",
        `<p>The account for <strong>${safeEmail}</strong> was already actioned before this request completed.</p>`,
        true
      );
    }

    await db.insert(activityLogs).values({
      userId: userId,
      action: "user_approved",
      resource: "users",
      resourceId: userId,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: {
        approvedEmail: user.email,
        approvedBy: "email-link",
        previousStatus: "pending_approval",
        method: "email_token",
      },
      severity: "info",
    });

    sendAccountApprovedEmail({ to: user.email, fullName: user.fullName }).catch((err) => {
      console.error("Failed to send approval email:", err);
    });

    return htmlPage(
      "Account approved",
      "Account approved successfully",
      `<p>The account for <strong>${safeEmail}</strong> has been approved.</p><p>They will receive a confirmation email shortly.</p>`,
      true
    );
  } else {
    // Atomic reject — same WHERE guard
    const result = await db
      .update(users)
      .set({ accountStatus: "suspended" })
      .where(and(eq(users.id, userId), eq(users.accountStatus, "pending_approval")))
      .returning({ id: users.id });

    if (result.length === 0) {
      return htmlPage(
        "Already actioned",
        "Account already reviewed",
        `<p>The account for <strong>${safeEmail}</strong> was already actioned before this request completed.</p>`,
        true
      );
    }

    await db
      .update(sessions)
      .set({
        isActive: 0,
        forceLogoutAt: new Date(),
        terminationReason: "registration_rejected",
      })
      .where(eq(sessions.userId, userId));

    await db.insert(activityLogs).values({
      userId: userId,
      action: "user_rejected",
      resource: "users",
      resourceId: userId,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: {
        rejectedEmail: user.email,
        rejectedBy: "email-link",
        previousStatus: "pending_approval",
        method: "email_token",
        emailSent: true,
      },
      severity: "warning",
    });

    sendAccountRejectedEmail({ to: user.email, fullName: user.fullName }).catch((err) => {
      console.error("Failed to send rejection email:", err);
    });

    return htmlPage(
      "Account rejected",
      "Registration rejected",
      `<p>The account for <strong>${safeEmail}</strong> has been rejected.</p><p>They will receive a notification email.</p>`,
      true
    );
  }
}
