-- Migration: Add approval_email_sent_at to users
-- Tracks when the most recent admin-notification email was sent for a
-- pending-approval user (initial signup or any admin-triggered resend).
-- Fully idempotent.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "approval_email_sent_at" timestamp;
