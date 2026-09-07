import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();

const PAYMENT_METHODS = ['cash', 'gcash', 'card', 'bank', 'check'] as const;

/** Derived shift totals. Payment-method totals are collections, while expected_cash
 * intentionally uses cash only because GCash/card/bank/check do not enter the drawer. */
async function getShiftMetrics(db: any, shiftId: string) {
  const [cash, refunds, events, paymentRows, refundRows] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(p.amount),0) total FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.shift_id=? AND p.method='cash' AND i.status <> 'voided'").get(shiftId),
    db.prepare("SELECT COALESCE(SUM(r.amount),0) total FROM refunds r JOIN invoices i ON i.id=r.invoice_id WHERE r.method='cash' AND r.shift_id=? AND i.status <> 'voided'").get(shiftId),
    db.prepare("SELECT COALESCE(SUM(CASE WHEN type='cash_in' THEN amount ELSE -amount END),0) total FROM cash_drawer_events WHERE shift_id=?").get(shiftId),
    db.prepare("SELECT p.method, COALESCE(SUM(p.amount),0) total FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.shift_id=? AND i.status <> 'voided' GROUP BY p.method").all(shiftId),
    db.prepare("SELECT r.method, COALESCE(SUM(r.amount),0) total FROM refunds r JOIN invoices i ON i.id=r.invoice_id WHERE r.shift_id=? AND i.status <> 'voided' GROUP BY r.method").all(shiftId),
  ]);
  const paymentMethods: Record<string, number> = Object.fromEntries(PAYMENT_METHODS.map(method => [method, 0]));
  const refundMethods: Record<string, number> = Object.fromEntries(PAYMENT_METHODS.map(method => [method, 0]));
  for (const row of paymentRows as any[]) if (row.method in paymentMethods) paymentMethods[row.method] = Number(row.total || 0);
  for (const row of refundRows as any[]) if (row.method in refundMethods) refundMethods[row.method] = Number(row.total || 0);
  const cashSales = Number((cash as any).total || 0);
  const cashRefunds = Number((refunds as any).total || 0);
  const drawerEvents = Number((events as any).total || 0);
  const totalCollections = Object.values(paymentMethods).reduce((sum, value) => sum + value, 0);
  const totalRefunds = Object.values(refundMethods).reduce((sum, value) => sum + value, 0);
  return { expected_cash_delta: cashSales - cashRefunds + drawerEvents, cash_sales: cashSales, cash_refunds: cashRefunds, drawer_events: drawerEvents, payment_methods: paymentMethods, refund_methods: refundMethods, total_collections: totalCollections, total_refunds: totalRefunds };
}

async function withShiftMetrics(db: any, shift: any) {
  const metrics = await getShiftMetrics(db, shift.id);
  return { ...shift, expected_cash: Number(shift.opening_cash || 0) + metrics.expected_cash_delta, ...metrics };
}

router.get('/current', async (req: Request, res: Response) => {
  const db = getDb();
  const shift = await db.prepare("SELECT * FROM cashier_shifts WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1").get(req.user!.id) as any;
  if (!shift) { res.json(null); return; }
  res.json(await withShiftMetrics(db, shift));
});

router.get('/history', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const where = req.user!.role === 'admin' ? '' : 'WHERE s.user_id = ?';
  const params = req.user!.role === 'admin' ? [] : [req.user!.id];
  const rows = await db.prepare(`SELECT s.*, u.username FROM cashier_shifts s LEFT JOIN users u ON u.id=s.user_id ${where} ORDER BY s.opened_at DESC LIMIT 50`).all(...params);
  res.json(rows);
});

router.get('/active', requireAdmin, async (_req: Request, res: Response) => {
  const db = getDb();
  const shifts = await db.prepare("SELECT s.*, u.username FROM cashier_shifts s LEFT JOIN users u ON u.id=s.user_id WHERE s.status='open' ORDER BY s.opened_at DESC").all() as any[];
  const result = [];
  for (const shift of shifts) {
    result.push(await withShiftMetrics(db, shift));
  }
  res.json(result);
});

router.get('/:id', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const shift = await db.prepare('SELECT s.*, u.username FROM cashier_shifts s LEFT JOIN users u ON u.id=s.user_id WHERE s.id=?').get(req.params.id) as any;
  if (!shift) { res.status(404).json({ error: 'Shift not found' }); return; }
  if (shift.user_id !== req.user!.id && req.user!.role !== 'admin') { res.status(403).json({ error: 'You can only view your own shift' }); return; }
  res.json(await withShiftMetrics(db, shift));
});

router.post('/open', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const openingCash = Number(req.body?.opening_cash);
  const targetUserId = typeof req.body?.user_id === 'string' ? req.body.user_id : '';
  if (!Number.isFinite(openingCash) || openingCash < 0) { res.status(400).json({ error: 'Opening cash must be zero or greater' }); return; }
  if (!targetUserId) { res.status(400).json({ error: 'Staff member is required' }); return; }
  const target = await db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(targetUserId) as any;
  if (!target) { res.status(404).json({ error: 'Staff member not found' }); return; }
  if (target.role !== 'staff') { res.status(400).json({ error: 'Only staff accounts can have cashier shifts' }); return; }
  const open = await db.prepare("SELECT id FROM cashier_shifts WHERE user_id = ? AND status = 'open'").get(targetUserId);
  if (open) { res.status(409).json({ error: 'You already have an open shift' }); return; }
  const id = uuidv4();
  await db.prepare('INSERT INTO cashier_shifts (id, user_id, opened_by, opening_cash) VALUES (?, ?, ?, ?)').run(id, targetUserId, req.user!.id, openingCash);
  await logAudit(req.user!.id, 'open', 'cashier_shift', id, `Opened ${target.username}; opening cash ${openingCash}`);
  res.status(201).json(await db.prepare('SELECT * FROM cashier_shifts WHERE id = ?').get(id));
});

router.post('/:id/close', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const closingCash = Number(req.body?.closing_cash);
  if (!Number.isFinite(closingCash) || closingCash < 0) { res.status(400).json({ error: 'Closing cash must be zero or greater' }); return; }
  const shift = await db.prepare("SELECT * FROM cashier_shifts WHERE id = ? AND status = 'open'").get(req.params.id) as any;
  if (!shift) { res.status(404).json({ error: 'Open shift not found' }); return; }
  const metrics = await getShiftMetrics(db, shift.id);
  const expected = Number(shift.opening_cash) + metrics.expected_cash_delta;
  await db.prepare("UPDATE cashier_shifts SET closed_at = datetime('now'), expected_cash = ?, closing_cash = ?, variance = ?, status = 'closed', notes = ?, closed_by = ? WHERE id = ?")
    .run(expected, closingCash, closingCash - expected, req.body?.notes || null, req.user!.id, shift.id);
  await logAudit(req.user!.id, 'close', 'cashier_shift', shift.id, `Expected ${expected}; counted ${closingCash}`);
  res.json(await db.prepare('SELECT * FROM cashier_shifts WHERE id = ?').get(shift.id));
});

router.post('/:id/event', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const shift = await db.prepare("SELECT * FROM cashier_shifts WHERE id=? AND status='open'").get(req.params.id) as any;
  const amount = Number(req.body?.amount);
  const type = req.body?.type;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!shift) { res.status(404).json({ error: 'Open shift not found' }); return; }
  if (!['cash_in','cash_out'].includes(type) || !Number.isFinite(amount) || amount <= 0 || reason.length < 3) { res.status(400).json({ error: 'Type, positive amount, and reason are required' }); return; }
  if (type === 'cash_out') {
    const cash = await db.prepare("SELECT COALESCE(SUM(p.amount),0) total FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.shift_id=? AND p.method='cash' AND i.status <> 'voided'").get(shift.id) as any;
    const refunds = await db.prepare("SELECT COALESCE(SUM(r.amount),0) total FROM refunds r JOIN invoices i ON i.id=r.invoice_id WHERE r.shift_id=? AND r.method='cash' AND i.status <> 'voided'").get(shift.id) as any;
    const events = await db.prepare("SELECT COALESCE(SUM(CASE WHEN type='cash_in' THEN amount ELSE -amount END),0) total FROM cash_drawer_events WHERE shift_id=?").get(shift.id) as any;
    const available = Number(shift.opening_cash) + Number(cash.total || 0) - Number(refunds.total || 0) + Number(events.total || 0);
    if (amount > available + 0.005) { res.status(400).json({ error: `Cash-out exceeds available drawer cash (${available.toFixed(2)})` }); return; }
  }
  const id = uuidv4();
  await db.prepare('INSERT INTO cash_drawer_events (id, shift_id, user_id, type, amount, reason) VALUES (?, ?, ?, ?, ?, ?)').run(id, shift.id, req.user!.id, type, amount, reason);
  await logAudit(req.user!.id, type, 'cash_drawer_event', id, reason, null, { shift_id: shift.id, type, amount, reason });
  res.status(201).json(await db.prepare('SELECT * FROM cash_drawer_events WHERE id=?').get(id));
});

router.get('/', requireAdmin, async (_req: Request, res: Response) => {
  res.json(await getDb().prepare('SELECT s.*, u.username FROM cashier_shifts s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.opened_at DESC LIMIT 100').all());
});

export default router;
