import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';

import { validateSignature } from './middleware/validateSignature';
import articlesRouter from './routes/articles';
import mediaRouter from './routes/media';
import podcastsRouter from './routes/podcasts';
import statusRouter from './routes/status';
import { logger } from './utils/logger';
import { getConfig } from './config';

export interface CreateAppOptions {
  enableCors?: boolean;
  corsOrigins?: string | string[];
  trustProxy?: boolean;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  
  if (options.trustProxy !== false) {
    app.set('trust proxy', 1);
  }
  
  app.use(helmet({
    contentSecurityPolicy: false,
  }));
  
  if (options.enableCors !== false) {
    app.use(cors({
      origin: options.corsOrigins || '*',
      credentials: true,
    }));
  }
  
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  
  app.use('/uploads', (req, res, next) => {
    express.static(path.resolve(getConfig().storagePath))(req, res, next);
  });
  
  app.use('/api/v1/status', statusRouter);
  
  app.use('/api/v1/articles', validateSignature, articlesRouter);
  app.use('/api/v1/media', validateSignature, mediaRouter);
  app.use('/api/v1/podcasts', validateSignature, podcastsRouter);
  
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      errorCode: 'INTERNAL_ERROR',
    });
  });
  
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Not found',
      errorCode: 'NOT_FOUND',
    });
  });
  
  return app;
}

export * from './types/payloads';
export * from './auth/hmac';
export * from './config';
export { logger } from './utils/logger';
