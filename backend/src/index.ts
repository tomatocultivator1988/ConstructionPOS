import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { initDb, getDb } from './db/setup';
import customerRoutes from './routes/customers';
import materialRoutes from './routes/materials';
import invoiceRoutes from './routes/invoices';
import settingsRoutes from './routes/settings';
import paymentRoutes from './routes/payments';
import analyticsRoutes from './routes/analytics';
import expenseRoutes from './routes/expenses';
import supplierRoutes from './routes/suppliers';
import purchaseOrderRoutes from './routes/purchase-orders';
import stockMovementRoutes from './routes/stock-movements';
import reportRoutes from './routes/reports';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import auditRoutes from './routes/audit';
import seedRoutes from './routes/seed';
import shiftRoutes from './routes/shifts';
import catalogRoutes from './routes/catalog';
import attendanceRoutes from './routes/attendance';
import { authMiddleware } from './lib/auth';

const app = express();
const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const NODE_ENV = process.env.NODE_ENV || ((process as any).pkg ? 'production' : 'development');

// Trust Vercel's proxy headers (X-Forwarded-For, etc)
app.set('trust proxy', 1);

// Lazy init DB on first request (needed for Vercel serverless)
app.use(async (_req, res, next) => {
  try {
    await initDb();
    next();
  } catch (e: any) {
    console.error('Request database initialization failed:', e.message);
    res.status(503).json({ error: 'Database temporarily unavailable. Please retry.', retryable: true });
  }
});

// Request logging
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS — restrict to known origin
app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-API-Token', 'Authorization'],
}));

// Body parsing with size limit
app.use(express.json({ limit: '1mb' }));

// Rate limiting
import rateLimit from 'express-rate-limit';
app.use('/api', rateLimit({
  windowMs: 60000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  message: { error: 'Too many requests, please try again later' },
  validate: { xForwardedForHeader: false, forwardedHeader: false },
}));

// JWT authentication
app.use('/api', authMiddleware);

// Public routes (no auth)
app.use('/api/auth', authRoutes);

// API routes
app.use('/api/customers', customerRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/stock-movements', stockMovementRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/audit-log', auditRoutes);
app.use('/api/seed', seedRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/attendance', attendanceRoutes);

app.get('/api/health', async (_req, res) => {
  try {
    const db = getDb();
    let userCount = (await db.prepare('SELECT COUNT(*) as cnt FROM users').get()) as any;
    if (userCount.cnt === 0) {
      const bcrypt = require('bcryptjs');
      const { v4: uuidv4 } = require('uuid');
      const hash = bcrypt.hashSync('0000', 10);
      await db.prepare('INSERT INTO users (id, username, pin_hash, role) VALUES (?, ?, ?, ?)').run(uuidv4(), 'admin', hash, 'admin');
      userCount = (await db.prepare('SELECT COUNT(*) as cnt FROM users').get()) as any;
    }
    res.json({ status: 'ok', environment: NODE_ENV, db: 'connected', users: userCount?.cnt ?? 0 });
  } catch (e: any) {
    res.json({ status: 'ok', environment: NODE_ENV, db: 'error', error: e.message });
  }
});

// In production, serve the built frontend
if (NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, 'frontend-dist');
  app.use(express.static(frontendDist));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  // Catch-all for unknown API routes (dev only)
  app.use((_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });
}

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    await initDb();
    const server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT} [${NODE_ENV}]`);
    });
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
    process.on('SIGINT', () => server.close(() => process.exit(0)));
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

// Vercel imports the app and manages the server lifecycle itself.
if (require.main === module) start();

export default app;
