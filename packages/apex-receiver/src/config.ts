import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export interface ReceiverConfig {
  port: number;
  apiKey: string;
  apexEngineUrl: string;
  storagePath: string;
  baseUrl: string;
  enableDebugLogging: boolean;
}

export function loadConfig(): ReceiverConfig {
  const apiKey = process.env.CITEFI_API_KEY;
  if (!apiKey) {
    throw new Error('CITEFI_API_KEY environment variable is required');
  }

  const apexEngineUrl = process.env.APEX_ENGINE_URL;
  if (!apexEngineUrl) {
    throw new Error('APEX_ENGINE_URL environment variable is required');
  }

  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    throw new Error('BASE_URL environment variable is required (e.g., https://yoursite.com)');
  }

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    apiKey,
    apexEngineUrl,
    storagePath: process.env.STORAGE_PATH || './uploads',
    baseUrl,
    enableDebugLogging: process.env.DEBUG === 'true',
  };
}

let _config: ReceiverConfig | null = null;

export function getConfig(): ReceiverConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}
