import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { pino } from 'pino';
import { config } from './config.js';
import { scrapeRouter } from './routes/scrape.js';
import { jobsRouter } from './routes/jobs.js';
import { accountsRouter } from './routes/accounts.js';
import { modelsRouter } from './routes/models.js';
import { mediaRouter } from './routes/media.js';
import { sessionRouter } from './routes/session.js';
import { onboardingRouter } from './routes/onboarding.js';
import { recommendationsRouter } from './routes/recommendations.js';
import { graphApiRouter } from './routes/graph.js';
import { notificationsRouter } from './routes/notifications.js';
import { calendarRouter } from './routes/calendar.js';
import { adminRouter } from './routes/admin.js';
import { schedulerService } from './services/scheduler.js';
import { JobWorker } from './lib/queue.js';
import { verifyTickSecret } from './lib/auth.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

const app = express();

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(config.clerkAuthorizedParties || []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      if (process.env.NODE_ENV !== 'production') {
        try {
          const url = new URL(origin);
          if (
            url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname === '::1' ||
            url.hostname.endsWith('.local')
          ) {
            return callback(null, true);
          }
        } catch {}
      }
      return callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'entangled-echo-api',
  });
});

// API Routes
app.use('/api/scrape', scrapeRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/models', modelsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/session', sessionRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/recommendations', recommendationsRouter);
app.use('/api/graph', graphApiRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/admin', adminRouter);
app.use('/internal/tick', async (req: Request, res: Response) => {
  const tickAuth = verifyTickSecret(req);
  if (!tickAuth.authorized) {
    return res.status(tickAuth.status || 401).json({ error: tickAuth.error });
  }

  try {
    const result = await schedulerService.runTick();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Centralized error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(err, 'Unhandled request error');
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  });
});

const server = app.listen(config.port, () => {
  logger.info(`EntangledEcho API server running on port ${config.port}`);
});
server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    logger.warn(`Port ${config.port} is already in use; skipping default listener.`);
  } else {
    logger.error(err, 'Server listen error');
  }
});

// Start background JobWorker inside the API process
const worker = new JobWorker();
worker.start().catch((err) => {
  logger.error(err, 'JobWorker crashed');
});

// Start 60-second automated publishing tick (FR-26)
const tickInterval = setInterval(() => {
  schedulerService.runTick().catch((err) => {
    logger.warn({ err }, 'Automated publishing tick encountered an error');
  });
}, 60000);

// Graceful shutdown
const shutdown = () => {
  logger.info('Shutting down server and worker...');
  clearInterval(tickInterval);
  worker.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;
