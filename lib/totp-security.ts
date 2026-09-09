import crypto from "crypto";

const CURRENT_KEY_VERSION = process.env.TOTP_ENCRYPTION_KEY_VERSION || "v1";
const ALGORITHM = "aes-256-gcm";

function sourceForVersion(version: string): string {
  const versionedName = `TOTP_ENCRYPTION_KEY_${version.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
  const source =
    process.env[versionedName] ||
    (version === "v1" ? process.env.TOTP_ENCRYPTION_KEY : undefined) ||
    (version === "v1" ? process.env.SESSION_SECRET : undefined) ||
    (version === "v1" ? process.env.JWT_SECRET : undefined);
  if (!source) {
    throw new Error(`TOTP encryption key ${version} is not configured`);
  }
  return source;
}

function keyForVersion(version: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`citefi:totp-secret:${version}\0`)
    .update(sourceForVersion(version))
    .digest();
}

export interface EncryptedTOTPSecret {
  ciphertext: string;
  keyVersion: string;
}

export function encryptTOTPSecret(secret: string): EncryptedTOTPSecret {
  const keyVersion = CURRENT_KEY_VERSION;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, keyForVersion(keyVersion), iv);
  cipher.setAAD(Buffer.from(`citefi:totp:${keyVersion}`));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: [iv, tag, encrypted].map((part) => part.toString("base64url")).join("."),
    keyVersion,
  };
}

export function decryptTOTPSecret(
  encrypted: string | null | undefined,
  keyVersion: string | null | undefined,
  legacyPlaintext?: string | null,
): string {
  if (!encrypted || !keyVersion) {
    if (legacyPlaintext && legacyPlaintext !== "encrypted") return legacyPlaintext;
    throw new Error("TOTP secret is unavailable");
  }
  const [ivValue, tagValue, ciphertextValue, extra] = encrypted.split(".");
  if (!ivValue || !tagValue || !ciphertextValue || extra) {
    throw new Error("TOTP secret envelope is invalid");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    keyForVersion(keyVersion),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAAD(Buffer.from(`citefi:totp:${keyVersion}`));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}