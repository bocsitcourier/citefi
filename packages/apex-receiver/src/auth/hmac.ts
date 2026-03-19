import crypto from 'crypto';

export function generateSignature(payload: string, apiKey: string, timestamp: string): string {
  const message = `${timestamp}.${payload}`;
  return crypto.createHmac('sha256', apiKey).update(message).digest('hex');
}

export function verifySignature(
  payload: string,
  signature: string,
  apiKey: string,
  timestamp: string,
  maxAgeMs: number = 300000
): { valid: boolean; error?: string } {
  const requestTime = parseInt(timestamp, 10);
  const currentTime = Date.now();
  
  if (isNaN(requestTime)) {
    return { valid: false, error: 'Invalid timestamp format' };
  }
  
  if (currentTime - requestTime > maxAgeMs) {
    return { valid: false, error: 'Request timestamp too old (replay protection)' };
  }
  
  if (requestTime > currentTime + 60000) {
    return { valid: false, error: 'Request timestamp is in the future' };
  }
  
  const expectedSignature = generateSignature(payload, apiKey, timestamp);
  
  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  
  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, error: 'Invalid signature length' };
  }
  
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, error: 'Invalid signature' };
  }
  
  return { valid: true };
}
