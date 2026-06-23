/**
 * Client Dashboard Playwright E2E Tests
 * ======================================
 * Browser-based tests for /client/usage, /client/billing, and /client/team.
 * Covers banner visibility, admin invite/remove flows, non-admin read-only
 * enforcement, and UpgradeModal appearance after a 402 paywall response.
 *
 * Run:
 *   npx playwright test tests/client/client-dashboard.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import {
  seedClientTeam,
  seedCreditUsage,
  patchTeamBilling,
  resetTeamBilling,
  cleanupClientTeam,
  type ClientSeedResult,
} from "./seed-client.js";
import { db } from "../../lib/db.js";
import { users, teamMembers } from "../../shared/schema.js";
import { hashPassword } from "../../lib/auth.js";
import { eq } from "drizzle-orm";

const RUN_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";

let seed: ClientSeedResult;

// ── Auth helper ───────────────────────────────────────────────────────────────

/** Log in as the given user via the login form and wait for redirect. */
async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.locator('[data-testid="input-email"]').fill(email);
  await page.locator('[data-testid="input-password"]').fill(password);
  await page.locator('[data-testid="button-login"]').click();
  // Wait until we've left the login page (redirect to /admin or wherever)
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

// ── Seed / teardown ───────────────────────────────────────────────────────────

test.beforeAll(async () => {
  seed = await seedClientTeam(RUN_ID);
  // Seed 25 article debits so usedPct >= 80 (free plan = 30 credits → 25/30 = 83%)
  await seedCreditUsage(seed.team.id, seed.adminUser.id, 25, "article", RUN_ID);
});

test.afterAll(async () => {
  await cleanupClientTeam(seed);
});

// ── /client/usage — low-credit amber banner ───────────────────────────────────

test.describe("/client/usage", () => {
  test("low-credit amber banner is visible when usedPct >= 80", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/usage`);

    // Wait for the usage data to load (the banner appears after fetch completes)
    const banner = page.locator('[data-testid="banner-low-credit"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
  });

  test("low-credit banner contains the usage percentage", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/usage`);

    const banner = page.locator('[data-testid="banner-low-credit"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    // Banner text references the usedPct (83% for 25 used of 30 allocated)
    await expect(banner).toContainText("%");
  });

  test("low-credit banner has an Upgrade button linking to /client/billing", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/usage`);

    const upgradeBtn = page.locator('[data-testid="link-upgrade-from-warning"]');
    await expect(upgradeBtn).toBeVisible({ timeout: 10_000 });
    await expect(upgradeBtn).toHaveAttribute("href", "/client/billing");
  });

  test("credit balance and progress bar are rendered", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/usage`);

    await expect(page.locator('[data-testid="text-credit-balance"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="progress-credit-usage"]')).toBeVisible({ timeout: 10_000 });
  });
});

// ── /client/billing — trial-expired banner ────────────────────────────────────

test.describe("/client/billing — trial-expired banner", () => {
  test.beforeEach(async () => {
    await patchTeamBilling(seed.team.id, {
      billingStatus: "trialing",
      currentPeriodEnd: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      stripeSubscriptionId: null,
    });
  });

  test.afterEach(async () => {
    await resetTeamBilling(seed.team.id);
  });

  test("trial-expired amber banner is visible when trial has ended", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/billing`);

    const banner = page.locator('[data-testid="banner-trial-expired"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
  });

  test("trial-expired banner contains 'Add payment method' call-to-action", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/billing`);

    const ctaButton = page.locator('[data-testid="button-trial-expired-upgrade"]');
    await expect(ctaButton).toBeVisible({ timeout: 10_000 });
    await expect(ctaButton).toContainText("Add payment method");
  });

  test("past-due banner is NOT shown when in trial-expired state", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/billing`);

    // Load the page fully (ensure trial-expired banner loads)
    await expect(page.locator('[data-testid="banner-trial-expired"]')).toBeVisible({ timeout: 10_000 });
    // Past-due banner must not be shown simultaneously
    await expect(page.locator('[data-testid="banner-past-due"]')).not.toBeVisible();
  });
});

// ── /client/billing — past-due banner ────────────────────────────────────────

test.describe("/client/billing — past-due banner", () => {
  test.beforeEach(async () => {
    await patchTeamBilling(seed.team.id, {
      billingStatus: "past_due",
    });
  });

  test.afterEach(async () => {
    await resetTeamBilling(seed.team.id);
  });

  test("past-due red banner is visible when payment has failed", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/billing`);

    const banner = page.locator('[data-testid="banner-past-due"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
  });

  test("past-due banner has a 'Fix payment' button", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/billing`);

    const fixBtn = page.locator('[data-testid="button-fix-payment"]');
    await expect(fixBtn).toBeVisible({ timeout: 10_000 });
    await expect(fixBtn).toContainText("Fix payment");
  });
});

// ── /client/team — admin invite flow ─────────────────────────────────────────

test.describe("/client/team — admin invite flow", () => {
  const testInviteEmail = `playwright_invite_${RUN_ID}@test.invalid`;

  test("admin sees the invite form with email input and submit button", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/team`);

    await expect(page.locator('[data-testid="input-invite-email"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="button-send-invite"]')).toBeVisible({ timeout: 10_000 });
  });

  test("admin submits invite form and invite link is displayed", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/team`);

    // Fill in the invite email
    await page.locator('[data-testid="input-invite-email"]').fill(testInviteEmail);

    // Submit the invite
    const sendBtn = page.locator('[data-testid="button-send-invite"]');
    await expect(sendBtn).toBeEnabled({ timeout: 5_000 });
    await sendBtn.click();

    // The invite link should appear after a successful invite
    const inviteLink = page.locator('[data-testid="input-invite-link"]');
    await expect(inviteLink).toBeVisible({ timeout: 10_000 });

    // The link value should contain the /accept-invite/ path
    const linkValue = await inviteLink.inputValue();
    expect(linkValue).toContain("/accept-invite/");
  });

  test("pending invite appears in the team page after creation", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/team`);

    // The pending invites section should show the email (created in previous test)
    // We reload to force a fresh data fetch since it might be cached
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Look for the invite email in pending invites
    await expect(page.getByText(testInviteEmail)).toBeVisible({ timeout: 10_000 });
  });
});

// ── /client/team — admin remove member flow ───────────────────────────────────

test.describe("/client/team — admin remove member flow", () => {
  let extraUserId: number | null = null;
  let extraMemberId: number | null = null;

  test.beforeAll(async () => {
    // Create an extra member to remove
    const hash = await hashPassword("Test!Pass#123");
    const [extraUser] = await db
      .insert(users)
      .values({
        email: `playwright_extra_${RUN_ID}@test.invalid`,
        passwordHash: hash,
        role: "team_member",
        accountStatus: "active",
        defaultTeamId: seed.team.id,
      })
      .returning({ id: users.id });

    const [extraMember] = await db
      .insert(teamMembers)
      .values({ teamId: seed.team.id, userId: extraUser.id, role: "member" })
      .returning({ id: teamMembers.id });

    extraUserId = extraUser.id;
    extraMemberId = extraMember.id;
  });

  test.afterAll(async () => {
    // Clean up the extra user if they weren't removed during the test
    if (extraUserId !== null) {
      await db.delete(teamMembers)
        .where(eq(teamMembers.userId, extraUserId))
        .catch(() => {});
      await db.delete(users)
        .where(eq(users.id, extraUserId))
        .catch(() => {});
      extraUserId = null;
    }
  });

  test("admin sees a remove button for other team members", async ({ page }) => {
    expect(extraMemberId).not.toBeNull();
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/team`);

    const removeBtn = page.locator(`[data-testid="button-remove-member-${extraMemberId}"]`);
    await expect(removeBtn).toBeVisible({ timeout: 10_000 });
  });

  test("clicking remove shows confirmation dialog", async ({ page }) => {
    expect(extraMemberId).not.toBeNull();
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/team`);

    // Click the remove button
    await page.locator(`[data-testid="button-remove-member-${extraMemberId}"]`).click();

    // Confirmation dialog should appear
    const confirmBtn = page.locator('[data-testid="button-confirm-remove"]');
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    const cancelBtn = page.locator('[data-testid="button-cancel-remove"]');
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 });
  });

  test("confirming removal removes the member from the list", async ({ page }) => {
    expect(extraMemberId).not.toBeNull();
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/team`);

    // Click remove
    await page.locator(`[data-testid="button-remove-member-${extraMemberId}"]`).click();

    // Confirm removal in the dialog
    await page.locator('[data-testid="button-confirm-remove"]').click();

    // Member row should disappear from the list
    const memberRow = page.locator(`[data-testid="row-member-${extraMemberId}"]`);
    await expect(memberRow).not.toBeVisible({ timeout: 10_000 });

    // Mark user as cleaned up (already removed from team_members)
    extraUserId = null;
  });
});

// ── /client/team — non-admin read-only enforcement ───────────────────────────

test.describe("/client/team — non-admin read-only view", () => {
  test("non-admin member does NOT see the invite form", async ({ page }) => {
    await loginAs(page, seed.memberUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/team`);

    // Wait for page to fully load (members table should be visible)
    await expect(page.getByText("Members")).toBeVisible({ timeout: 10_000 });

    // Invite form must NOT be present for non-admin
    await expect(page.locator('[data-testid="input-invite-email"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="button-send-invite"]')).not.toBeVisible();
  });

  test("non-admin member does NOT see remove buttons", async ({ page }) => {
    await loginAs(page, seed.memberUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/team`);

    // Wait for members table
    await expect(page.getByText("Members")).toBeVisible({ timeout: 10_000 });

    // No remove buttons should be visible for non-admin
    const removeButtons = page.locator('[data-testid^="button-remove-member-"]');
    await expect(removeButtons).toHaveCount(0, { timeout: 5_000 });
  });
});

// ── UpgradeModal — appears on 402 paywall response ───────────────────────────

test.describe("UpgradeModal — paywall 402 response", () => {
  test("UpgradeModal appears when citefi:paywall event is dispatched", async ({ page }) => {
    // Log in as admin (any authenticated page will do)
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/usage`);

    // Wait for page to render
    await page.waitForLoadState("networkidle");

    // Dispatch the paywall event as apiRequest does on a 402 response
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("citefi:paywall", {
          detail: {
            error: "TRIAL_EXPIRED",
            trialExpired: true,
            planId: "free",
            billingStatus: "trialing",
            creditBalance: 0,
            upgradeUrl: "/client/billing",
            message: "Your trial has ended. Add a payment method to continue generating content.",
          },
        })
      );
    });

    // UpgradeModal should open
    await expect(page.locator('[data-testid="upgrade-plan-starter"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="upgrade-plan-growth"]')).toBeVisible({ timeout: 5_000 });
  });

  test("UpgradeModal can be dismissed", async ({ page }) => {
    await loginAs(page, seed.adminUser.email, seed.password);
    await page.goto(`${BASE_URL}/client/usage`);
    await page.waitForLoadState("networkidle");

    // Open modal
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("citefi:paywall", { detail: { error: "TRIAL_EXPIRED", trialExpired: true } })
      );
    });

    await expect(page.locator('[data-testid="upgrade-plan-starter"]')).toBeVisible({ timeout: 5_000 });

    // Dismiss
    await page.locator('[data-testid="button-dismiss-upgrade"]').click();
    await expect(page.locator('[data-testid="upgrade-plan-starter"]')).not.toBeVisible({ timeout: 5_000 });
  });

  test("trial-expired team gets 402 TRIAL_EXPIRED from /api/seo/create-articles", async ({ page }) => {
    // Configure the team as trial-expired
    await patchTeamBilling(seed.team.id, {
      billingStatus: "trialing",
      currentPeriodEnd: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      stripeSubscriptionId: null,
    });

    // Log in to get a session, then use the page's request context to hit the API
    await loginAs(page, seed.adminUser.email, seed.password);

    // Use Playwright's request API from the page context (inherits cookies/sessionStorage)
    const response = await page.request.post("/api/seo/create-articles", {
      data: {
        seoToolType: "local_research",
        seoToolOutput: { location: "Austin, TX", business_type: "plumber" },
        targetUrl: "https://example.com",
      },
    });

    expect(response.status()).toBe(402);
    const body = await response.json();
    expect(body.error).toBe("TRIAL_EXPIRED");
    expect(body.trialExpired).toBe(true);

    await resetTeamBilling(seed.team.id);
  });
});
