import crypto from 'crypto';

const IV_LENGTH = 16;
const ALGORITHM = 'aes-256-cbc';

function getEncryptionKey(): Buffer {
  const envKey = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!envKey || envKey.length < 32) {
    throw new Error('API_KEY_ENCRYPTION_SECRET environment variable must be set with at least 32 characters for encryption');
  }
  return Buffer.from(envKey.slice(0, 32), 'utf8');
}

export function generateSignature(payload: string, apiKey: string, timestamp: string): string {
  const message = `${timestamp}.${payload}`;
  return crypto.createHmac('sha256', apiKey).update(message).digest('hex');
}

export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

export function generateApiKey(): string {
  return `apex_${crypto.randomBytes(32).toString('hex')}`;
}

export function verifyApiKeyHash(apiKey: string, hash: string): boolean {
  const computedHash = hashApiKey(apiKey);
  return crypto.timingSafeEqual(
    Buffer.from(computedHash, 'hex'),
    Buffer.from(hash, 'hex')
  );
}

export function encryptApiKey(apiKey: string): string {
  const keyBuffer = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

export function decryptApiKey(encryptedApiKey: string): string {
  const keyBuffer = getEncryptionKey();
  const [ivHex, encryptedHex] = encryptedApiKey.split(':');
  const iv = Buffer.from(ivHex!, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  let decrypted = '';
  decrypted += decipher.update(encryptedHex!, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
