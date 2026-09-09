/**
 * Backward-compatible MFA hardening migration.
 * Run before deploying code that writes encrypted TOTP secrets:
 * node --env-file=.env.local --import tsx/esm scripts/migrate-auth-mfa-hardening.ts
 */
import { Pool } from "pg";
import { encryptTOTPSecret } from "../lib/totp-security.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
  max: 2,
});

async function run() {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enrollment_deadline TIMESTAMP`);
  await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auth_assurance VARCHAR(20) NOT NULL DEFAULT 'password'`);
  await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMP`);
  await pool.query(`ALTER TABLE totp_secrets ADD COLUMN IF NOT EXISTS secret_ciphertext TEXT`);
  await pool.query(`ALTER TABLE totp_secrets ADD COLUMN IF NOT EXISTS secret_key_version VARCHAR(32)`);
  await pool.query(`ALTER TABLE totp_secrets ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 1`);
  await pool.query(`ALTER TABLE totp_secrets ADD COLUMN IF NOT EXISTS last_used_counter INTEGER`);
  await pool.query(`ALTER TABLE login_challenges DROP CONSTRAINT IF EXISTS login_challenges_method_check`);
  await pool.query(`ALTER TABLE login_challenges DROP CONSTRAINT IF EXISTS login_challenges_email_code`);
  await pool.query(`
    ALTER TABLE login_challenges
    ADD CONSTRAINT login_challenges_method_check
    CHECK (method IN ('totp', 'email', 'totp_setup'))
  `);
  await pool.query(`
    ALTER TABLE login_challenges
    ADD CONSTRAINT login_challenges_email_code
    CHECK (
      (method = 'email' AND email_code_hash IS NOT NULL)
      OR (method IN ('totp', 'totp_setup') AND email_code_hash IS NULL)
    )
  `);

  const existing = await pool.query<{ id: number; secret: string }>(`
    SELECT id, secret
    FROM totp_secrets
    WHERE secret_ciphertext IS NULL AND secret <> 'encrypted'
  `);
  for (const row of existing.rows) {
    const encrypted = encryptTOTPSecret(String(row.secret));
    await pool.query(`
      UPDATE totp_secrets
      SET secret = 'encrypted',
          secret_ciphertext = $1,
          secret_key_version = $2
      WHERE id = $3
        AND secret_ciphertext IS NULL
    `, [encrypted.ciphertext, encrypted.keyVersion, Number(row.id)]);
  }

  await pool.query(`
    UPDATE users
    SET mfa_enrollment_deadline = NOW() + INTERVAL '7 days'
    WHERE role = 'admin'
      AND account_status = 'active'
      AND mfa_enrollment_deadline IS NULL
  `);

  console.log(`MFA hardening migration complete; encrypted ${existing.rows.length} legacy secret(s).`);
}

run()
  .catch((error) => {
    console.error("MFA hardening migration failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());