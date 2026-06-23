import { getConfig } from '../config';
import { generateSignature } from '../auth/hmac';
import { CallbackPayload } from '../types/payloads';
import { logger } from '../utils/logger';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendCallback(payload: CallbackPayload): Promise<boolean> {
  const callbackUrl = `${getConfig().apexEngineUrl}/api/publishing/callbacks`;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const body = JSON.stringify(payload);
      const timestamp = Date.now().toString();
      const signature = generateSignature(body, getConfig().apiKey, timestamp);
      
      logger.info('Sending callback', {
        jobId: payload.jobId,
        status: payload.status,
        attempt,
        url: callbackUrl,
      });
      
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Citefi-Signature': signature,
          'X-Citefi-Timestamp': timestamp,
        },
        body,
      });
      
      if (response.ok) {
        logger.info('Callback sent successfully', {
          jobId: payload.jobId,
          status: payload.status,
        });
        return true;
      }
      
      const errorText = await response.text();
      logger.warn('Callback failed', {
        jobId: payload.jobId,
        status: response.status,
        error: errorText,
        attempt,
      });
      
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      
      return false;
    } catch (error) {
      logger.error('Callback error', {
        jobId: payload.jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
        attempt,
      });
      
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      
      return false;
    }
  }
  
  return false;
}

export function createSuccessCallback(
  jobId: string,
  pageUrl: string,
  slug: string,
  mediaUrls?: Record<string, string>
): CallbackPayload {
  return {
    jobId,
    status: 'success',
    pageUrl,
    slug,
    mediaUrls,
    timestamp: new Date().toISOString(),
  };
}

export function createFailureCallback(
  jobId: string,
  error: string,
  errorCode?: string
): CallbackPayload {
  return {
    jobId,
    status: 'failure',
    error,
    errorCode,
    timestamp: new Date().toISOString(),
  };
}
