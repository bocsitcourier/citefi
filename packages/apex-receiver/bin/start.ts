import { createApp } from '../src/index';
import { loadConfig, getConfig } from '../src/config';
import { logger } from '../src/utils/logger';

async function main() {
  try {
    loadConfig();
  } catch (error) {
    console.error('Configuration error:', error instanceof Error ? error.message : error);
    console.error('\nRequired environment variables:');
    console.error('  CITEFI_API_KEY      - API key for authentication with Citefi');
    console.error('  APEX_ENGINE_URL   - URL of the Citefi (e.g., https://your-apex-engine.com)');
    console.error('  BASE_URL          - Public URL of this receiver site (e.g., https://yoursite.com)');
    console.error('\nOptional environment variables:');
    console.error('  PORT              - Server port (default: 3000)');
    console.error('  STORAGE_PATH      - Local storage path (default: ./uploads)');
    console.error('  DEBUG             - Enable debug logging (default: false)');
    process.exit(1);
  }

  const cfg = getConfig();

  const app = createApp({
    enableCors: true,
    trustProxy: true,
  });

  const port = cfg.port;

  app.listen(port, '0.0.0.0', () => {
    logger.info('Citefi Receiver started', {
      port,
      baseUrl: cfg.baseUrl,
      apexEngineUrl: cfg.apexEngineUrl,
      storagePath: cfg.storagePath,
    });
    
    console.log(`\n🚀 Citefi Receiver is running on port ${port}`);
    console.log(`   Base URL: ${cfg.baseUrl}`);
    console.log(`   Apex Engine: ${cfg.apexEngineUrl}`);
    console.log(`   Storage: ${cfg.storagePath}`);
    console.log('\nEndpoints:');
    console.log(`   GET  /api/v1/status/ping    - Health check`);
    console.log(`   POST /api/v1/articles       - Receive articles`);
    console.log(`   POST /api/v1/media          - Receive media files`);
    console.log(`   POST /api/v1/podcasts       - Receive podcasts`);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
