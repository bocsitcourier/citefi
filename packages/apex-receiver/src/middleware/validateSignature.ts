import { Request, Response, NextFunction } from 'express';
import { verifySignature } from '../auth/hmac';
import { getConfig } from '../config';
import { logger } from '../utils/logger';

export function validateSignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-citefi-signature'] as string;
  const timestamp = req.headers['x-citefi-timestamp'] as string;
  
  if (!signature || !timestamp) {
    logger.warn('Missing authentication headers', {
      hasSignature: !!signature,
      hasTimestamp: !!timestamp,
      ip: req.ip,
    });
    res.status(401).json({
      success: false,
      error: 'Missing authentication headers',
      errorCode: 'AUTH_HEADERS_MISSING',
    });
    return;
  }
  
  const payload = JSON.stringify(req.body);
  const result = verifySignature(payload, signature, getConfig().apiKey, timestamp);
  
  if (!result.valid) {
    logger.warn('Signature verification failed', {
      error: result.error,
      ip: req.ip,
    });
    res.status(401).json({
      success: false,
      error: result.error,
      errorCode: 'AUTH_SIGNATURE_INVALID',
    });
    return;
  }
  
  next();
}
