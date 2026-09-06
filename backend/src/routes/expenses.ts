import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();
router.use(requireAdmin);

const EXPENSE_CATEGORIES = [
  'Rent', 'Utilities', 'Labor/Salary', 'Delivery/Transport',
  'Tools & Equipment', 'Maintenance', 'Supplies', 'Other'
];
const PAYMENT_METHODS = ['cash', 'bank', 'card', 'gcash', 'check', 'credit'];

function validateExpense(body: any, existing?: any) {
  const errors: string[] = [];
  const category = body.category ?? existing?.category;
  const amount = body.amount !== undefined ? body.amount : existing?.amount;
  const expense_date = body.expense_date ?? existing?.expense_date;
  const description = body.description !== undefined ? body.description : existing?.description;
  const vendor = body.vendor !== undefined ? body.vendor : existing?.vendor;
  const payment_method = body.payment_method ?? existing?.payment_method ?? 'cash';

  if (body.category !== undefined && (typeof category !== 'string' || !category.trim())) {
    errors.push('Valid category is required');
  }
  if (typeof category !== 'string' || !category.trim()) errors.push('Valid category is required');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) errors.push('Amount must be greater than 0');
  if (typeof expense_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expense_date)) errors.push('Valid date is required');
  if (body.amount !== undefined && (isNaN(amount) || amount <= 0)) {
    errors.push('Amount must be greater than 0');
  }
  if (body.expense_date !== undefined && !expense_date) {
    errors.push('Date is required');
  }
  if (!PAYMENT_METHODS.includes(payment_method)) errors.push('Valid payment method is required');
  return { category, amount, description, vendor, expense_date, payment_method, errors };
}

router.get('/', async (req: Request, res: Response) => {
  const db = getDb();
  let query = 'SELECT * FROM expenses';
  const params: any[] = [];
  const conditions: string[] = [];

  if (req.query.category) {
    conditions.push('category = ?');
    params.push(req.query.category);
  }
  if (req.query.from) {
    conditions.push('expense_date >= ?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    conditions.push('expense_date <= ?');
    params.push(req.query.to);
  }

  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY expense_date DESC, created_at DESC';

  const expenses = await db.prepare(query).all(...params);
  res.json(expenses);
});

router.get('/summary', async (req: Request, res: Response) => {
  const db = getDb();
  let query = "SELECT category, SUM(amount) AS total FROM expenses";
  const params: any[] = [];
  const conditions: string[] = [];

  if (req.query.from) {
    conditions.push('expense_date >= ?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    conditions.push('expense_date <= ?');
    params.push(req.query.to);
  }

  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' GROUP BY category ORDER BY total DESC';

  res.json(await db.prepare(query).all(...params));
});

router.get('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const expense = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!expense) { res.status(404).json({ error: 'Expense not found' }); return; }
  res.json(expense);
});

router.post('/', async (req: Request, res: Response) => {
  const db = getDb();
  const validation = validateExpense(req.body);
  if (validation.errors.length) {
    res.status(400).json({ error: validation.errors.join('; ') });
    return;
  }
  const id = uuidv4();
  await db.prepare(
    'INSERT INTO expenses (id, category, amount, description, vendor, expense_date, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, validation.category, validation.amount, validation.description || null, validation.vendor || null, validation.expense_date, validation.payment_method);
  const expense = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  await logAudit((req as any).user?.id || null, 'create', 'expense', id, `${validation.category} — ${validation.amount}`, null, expense);
  res.status(201).json(expense);
});

router.put('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Expense not found' }); return; }
  const validation = validateExpense(req.body, existing);
  if (validation.errors.length) {
    res.status(400).json({ error: validation.errors.join('; ') });
    return;
  }
  await db.prepare(
    'UPDATE expenses SET category=?, amount=?, description=?, vendor=?, expense_date=?, payment_method=? WHERE id=?'
  ).run(validation.category, validation.amount, validation.description || null, validation.vendor || null, validation.expense_date, validation.payment_method, req.params.id);
  const updated = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  await logAudit((req as any).user?.id || null, 'update', 'expense', req.params.id as string, undefined, existing, updated);
  res.json(updated);
});

router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Expense not found' }); return; }
  const name = (existing as any).category + ' ' + (existing as any).amount;
  await db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  await logAudit((req as any).user?.id || null, 'delete', 'expense', req.params.id as string, name, existing, null);
  res.status(204).send();
});

export { EXPENSE_CATEGORIES };
export default router;
