import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import { nanoid } from "nanoid";
import crypto from "crypto";

// CRITICAL: JWT secret must be set in environment - fail fast if missing
if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set. Authentication cannot proceed.");
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = "24h"; // 24 hours - prevents frequent re-login
const REFRESH_TOKEN_EXPIRES_IN = "7d"; // 7 days

// ============================================================================
// PASSWORD HASHING
// ============================================================================

export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ============================================================================
// JWT TOKEN MANAGEMENT
// ============================================================================

export interface JWTPayload {
  userId: number;
  email: string;
  role: string;
  sessionId?: number;
}

export function generateAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function generateRefreshToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ============================================================================
// TOTP (Google Authenticator)
// ============================================================================

export interface TOTPSetup {
  secret: string;
  qrCodeUrl: string;
  manualEntryKey: string;
}

export async function generateTOTPSecret(userEmail: string, appName: string = "ApexContent Engine"): Promise<TOTPSetup> {
  const secret = speakeasy.generateSecret({
    name: `${appName} (${userEmail})`,
    issuer: appName,
    length: 32,
  });

  const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url!);

  return {
    secret: secret.base32!,
    qrCodeUrl,
    manualEntryKey: secret.base32!,
  };
}

export function verifyTOTPToken(token: string, secret: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 2, // Allow 2 steps before/after for clock drift
  });
}

// ============================================================================
// EMAIL VERIFICATION CODES
// ============================================================================

export function generateEmailCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ============================================================================
// BACKUP CODES
// ============================================================================

export async function generateBackupCodes(count: number = 10): Promise<string[]> {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(nanoid(12));
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map(code => hashPassword(code)));
}

export async function verifyBackupCode(code: string, hashedCodes: string[]): Promise<boolean> {
  for (const hashedCode of hashedCodes) {
    if (await verifyPassword(code, hashedCode)) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// PASSWORD VALIDATION
// ============================================================================

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }

  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// RATE LIMITING HELPERS
// ============================================================================

export function calculateLockoutDuration(failedAttempts: number): number {
  if (failedAttempts >= 10) return 60 * 60 * 1000; // 1 hour
  if (failedAttempts >= 7) return 30 * 60 * 1000; // 30 minutes
  if (failedAttempts >= 5) return 15 * 60 * 1000; // 15 minutes
  return 0;
}

export function isAccountLocked(lockedUntil: Date | null): boolean {
  if (!lockedUntil) return false;
  return new Date() < new Date(lockedUntil);
}
