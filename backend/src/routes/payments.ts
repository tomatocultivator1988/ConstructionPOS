import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';

const router = Router();
router.use(requireAdmin);

router.get('/receipts', async (req: Request, res: Response) => {
  const db = getDb();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 15));
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  const conditions = ["i.status <> 'voided'"];
  const params: any[] = [];
  if (search) { conditions.push('(i.invoice_number LIKE ? OR COALESCE(c.name, \'Walk-in\') LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (from) { conditions.push('date(p.payment_date) >= ?'); params.push(from); }
  if (to) { conditions.push('date(p.payment_date) <= ?'); params.push(to); }
  const where = conditions.join(' AND ');
  const total = Number((await db.prepare(`SELECT COUNT(*) total FROM payments p JOIN invoices i ON i.id=p.invoice_id LEFT JOIN customers c ON c.id=i.customer_id WHERE ${where}`).get(...params) as any).total);
  const data = await db.prepare(`SELECT p.id, p.invoice_id, p.payment_date, p.amount, p.method, p.notes, i.invoice_number, i.status,
    COALESCE(c.name,'Walk-in') customer_name,
    COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id=i.id),0) - COALESCE((SELECT SUM(amount) FROM refunds WHERE invoice_id=i.id),0) refundable_amount
    FROM payments p JOIN invoices i ON i.id=p.invoice_id LEFT JOIN customers c ON c.id=i.customer_id WHERE ${where}
    ORDER BY p.payment_date DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
});

router.get('/summary', async (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const daily = await db.prepare(`
      SELECT date(payment_date) as date, COALESCE(SUM(amount), 0) as total
      FROM payments p JOIN invoices i ON i.id=p.invoice_id
      WHERE i.status <> 'voided' AND
      p.payment_date >= datetime('now', '-7 days')
      GROUP BY date(payment_date)
      ORDER BY date ASC
    `).all();

    const today = await db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) - COALESCE((SELECT SUM(r.amount) FROM refunds r JOIN invoices ri ON ri.id=r.invoice_id WHERE ri.status <> 'voided' AND date(r.created_at, '+8 hours') = date('now', '+8 hours')), 0) as total
      FROM payments p JOIN invoices i ON i.id=p.invoice_id
      WHERE i.status <> 'voided' AND date(p.payment_date, '+8 hours') = date('now', '+8 hours')
    `).get() as any;

    res.json({ daily, todayTotal: today.total });
  } catch (e: any) {
    console.error('Payments summary error:', e.message);
    res.json({ daily: [], todayTotal: 0 });
  }
});

export default router;
