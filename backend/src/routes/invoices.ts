import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin, requireAdminOrPOS } from '../lib/auth';
import { logAudit } from '../lib/audit';
import { clearCache } from '../lib/cache';

const router = Router();
router.use(requireAdminOrPOS);
const PAYMENT_METHODS = ['cash', 'card', 'bank', 'gcash', 'check', 'credit'];
const SETTLEMENT_METHODS = ['cash', 'card', 'bank', 'gcash', 'check'];
const REFUND_METHODS = ['cash', 'card', 'bank', 'gcash', 'check'];

async function refreshInvoiceStatus(db: ReturnType<typeof getDb>, invoiceId: string) {
  const invoice = await db.prepare('SELECT total, status FROM invoices WHERE id=?').get(invoiceId) as any;
  if (!invoice || invoice.status === 'voided') return;
  const credits = await db.prepare("SELECT COALESCE(SUM(amount),0) total FROM credit_memos WHERE invoice_id=? AND status='issued'").get(invoiceId) as any;
  const returns = await db.prepare('SELECT COALESCE(SUM(total_credit),0) total FROM invoice_returns WHERE invoice_id=?').get(invoiceId) as any;
  const payments = await db.prepare('SELECT COALESCE(SUM(amount),0) total FROM payments WHERE invoice_id=?').get(invoiceId) as any;
  const refunds = await db.prepare('SELECT COALESCE(SUM(amount),0) total FROM refunds WHERE invoice_id=?').get(invoiceId) as any;
  const adjustedTotal = Math.max(0, Number(invoice.total) - Number(credits.total || 0) - Number(returns.total || 0));
  const netPaid = Number(payments.total || 0) - Number(refunds.total || 0);
  const status = netPaid >= adjustedTotal - 0.005 ? 'paid' : netPaid > 0 ? 'partial' : 'pending';
  await db.prepare("UPDATE invoices SET status=?, paid_date=CASE WHEN ?='paid' THEN COALESCE(paid_date, datetime('now')) ELSE NULL END WHERE id=?")
    .run(status, status, invoiceId);
}

router.get('/', async (req: Request, res: Response) => {
  const db = getDb();
  const conditions: string[] = []; const params: any[] = [];
  if (typeof req.query.from === 'string' && req.query.from) { conditions.push('date(i.issued_date) >= ?'); params.push(req.query.from); }
  if (typeof req.query.to === 'string' && req.query.to) { conditions.push('date(i.issued_date) <= ?'); params.push(req.query.to); }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const baseQuery = `
    SELECT i.*, COALESCE(NULLIF(i.credit_account_name,''), c.name, 'Walk-in') AS customer_name, c.address AS customer_address, c.tin AS customer_tin,
      i.total - COALESCE((SELECT SUM(amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0) - COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0) AS adjusted_total,
      i.tax_amount - COALESCE((SELECT SUM(tax_amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0) - CASE WHEN i.tax_rate > 0 THEN COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0) * i.tax_rate / (1+i.tax_rate) ELSE 0 END AS adjusted_tax,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id),0) - COALESCE((SELECT SUM(amount) FROM refunds r WHERE r.invoice_id=i.id),0) AS net_paid
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    ${where}
    ORDER BY i.created_at DESC`;
  if (req.query.page !== undefined) {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 15));
    const total = Number((await db.prepare(`SELECT COUNT(*) total FROM invoices i${where}`).get(...params) as any).total);
    const data = req.query.export === '1' ? await db.prepare(baseQuery).all(...params) : await db.prepare(`${baseQuery} LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
    res.json({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
    return;
  }
  res.json(await db.prepare(baseQuery).all(...params));
});

router.get('/receivables', async (req: Request, res: Response) => {
  const db = getDb();
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : 'all';
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  const exportMode = req.query.export === '1';
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 15));
  const balance = `i.total - COALESCE((SELECT SUM(amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0) - COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0) - (COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id AND p.method <> 'credit'),0) - COALESCE((SELECT SUM(amount) FROM refunds r WHERE r.invoice_id=i.id),0))`;
  const conditions = ["i.status <> 'voided'", "(i.credit_account_name IS NOT NULL OR EXISTS (SELECT 1 FROM payments cp WHERE cp.invoice_id=i.id AND cp.method='credit') )"];
  const params: any[] = [];
  if (search) { conditions.push("COALESCE(NULLIF(i.credit_account_name,''), c.name, 'Unassigned Credit') LIKE ?"); params.push(`%${search}%`); }
  if (status === 'unpaid') conditions.push(`${balance} > 0 AND (COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id),0) = 0)`);
  if (status === 'partial') conditions.push(`${balance} > 0 AND COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id),0) > 0`);
  if (status === 'paid') conditions.push(`${balance} <= 0`);
  if (from) { conditions.push('date(i.issued_date) >= ?'); params.push(from); }
  if (to) { conditions.push('date(i.issued_date) <= ?'); params.push(to); }
  const where = conditions.join(' AND ');
  const select = `SELECT i.id, i.invoice_number, i.issued_date, i.total, i.status, i.credit_account_name,
    COALESCE(NULLIF(i.credit_account_name,''), c.name, 'Unassigned Credit') AS account_name,
    COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id AND p.method <> 'credit'),0) - COALESCE((SELECT SUM(amount) FROM refunds r WHERE r.invoice_id=i.id),0) AS net_paid,
    ${balance} AS balance
    FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE ${where}`;
  const total = Number((await db.prepare(`SELECT COUNT(*) AS total FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE ${where}`).get(...params) as any).total || 0);
  const summary = await db.prepare(`SELECT COUNT(*) AS credit_sales, SUM(CASE WHEN balance > 0.005 THEN balance ELSE 0 END) AS outstanding, SUM(CASE WHEN balance > 0.005 THEN 1 ELSE 0 END) AS open_accounts, SUM(CASE WHEN balance <= 0.005 THEN 1 ELSE 0 END) AS paid_sales FROM (${select}) receivables`).get(...params) as any;
  const data = exportMode
    ? await db.prepare(`${select} ORDER BY CASE WHEN balance > 0.005 THEN 0 ELSE 1 END, balance DESC, i.issued_date ASC`).all(...params)
    : await db.prepare(`${select} ORDER BY CASE WHEN balance > 0.005 THEN 0 ELSE 1 END, balance DESC, i.issued_date ASC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize), summary: { credit_sales: Number(summary.credit_sales || 0), outstanding: Number(summary.outstanding || 0), open_accounts: Number(summary.open_accounts || 0), paid_sales: Number(summary.paid_sales || 0) } });
});

router.get('/receivables-trend', async (_req: Request, res: Response) => {
  const db = getDb();
  const rows = await db.prepare(`
    WITH RECURSIVE months(month_start, month_end, step) AS (
      SELECT date('now', '+8 hours', 'start of month', '-2 months'), date('now', '+8 hours', 'start of month', '-1 day'), 0
      UNION ALL
      SELECT date(month_start, '+1 month'), date(date(month_start, '+2 months'), '-1 day'), step + 1
      FROM months WHERE step < 2
    )
    SELECT strftime('%Y-%m', month_start) AS month,
      COALESCE((SELECT SUM(i.total - COALESCE((SELECT SUM(amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0) - COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0))
        FROM invoices i WHERE i.status <> 'voided' AND (i.credit_account_name IS NOT NULL OR EXISTS (SELECT 1 FROM payments cp WHERE cp.invoice_id=i.id AND cp.method='credit') ) AND date(i.issued_date, '+8 hours') BETWEEN months.month_start AND months.month_end), 0) AS credit_sales,
      COALESCE((SELECT SUM(i.total - COALESCE((SELECT SUM(amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0) - COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0))
        FROM invoices i WHERE i.status <> 'voided' AND NOT (i.credit_account_name IS NOT NULL OR EXISTS (SELECT 1 FROM payments cp WHERE cp.invoice_id=i.id AND cp.method='credit') ) AND date(i.issued_date, '+8 hours') BETWEEN months.month_start AND months.month_end), 0) AS immediate_sales,
      COALESCE((SELECT SUM(p.amount)
        FROM payments p JOIN invoices i ON i.id=p.invoice_id
        WHERE p.method <> 'credit' AND i.status <> 'voided' AND date(p.payment_date, '+8 hours') BETWEEN months.month_start AND months.month_end), 0)
      - COALESCE((SELECT SUM(r.amount)
        FROM refunds r JOIN invoices ri ON ri.id=r.invoice_id
        WHERE ri.status <> 'voided' AND r.method <> 'credit' AND date(r.created_at, '+8 hours') BETWEEN months.month_start AND months.month_end), 0) AS collections
      , COALESCE((SELECT SUM(i.total - COALESCE((SELECT SUM(amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued' AND date(cm.created_at, '+8 hours') <= months.month_end),0) - COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id AND date(ir.created_at, '+8 hours') <= months.month_end),0) - (COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id AND p.method <> 'credit' AND date(p.payment_date, '+8 hours') <= months.month_end),0) - COALESCE((SELECT SUM(amount) FROM refunds r WHERE r.invoice_id=i.id AND r.method <> 'credit' AND date(r.created_at, '+8 hours') <= months.month_end),0)))
        FROM invoices i WHERE i.status <> 'voided' AND (i.credit_account_name IS NOT NULL OR EXISTS (SELECT 1 FROM payments cp WHERE cp.invoice_id=i.id AND cp.method='credit')) AND date(i.issued_date, '+8 hours') <= months.month_end), 0) AS current_balance
    FROM months ORDER BY month_start
  `).all();
  res.json(rows.map((row: any) => ({ month: row.month, credit_sales: Number(row.credit_sales || 0), immediate_sales: Number(row.immediate_sales || 0), collections: Number(row.collections || 0), current_balance: Math.max(0, Number(row.current_balance || 0)) })));
});

router.get('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const invoice = await db.prepare(`
    SELECT i.*, COALESCE(NULLIF(i.credit_account_name,''), c.name, 'Walk-in') AS customer_name, c.address AS customer_address, c.tin AS customer_tin,
      i.total - COALESCE((SELECT SUM(amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0) - COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0) AS adjusted_total,
      i.tax_amount - COALESCE((SELECT SUM(tax_amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0) - CASE WHEN i.tax_rate > 0 THEN COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0) * i.tax_rate / (1+i.tax_rate) ELSE 0 END AS adjusted_tax,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id),0) - COALESCE((SELECT SUM(amount) FROM refunds r WHERE r.invoice_id=i.id),0) AS net_paid
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
  const items = await db.prepare(`
    SELECT ii.*,
      COALESCE((SELECT SUM(ir.quantity) FROM invoice_returns ir WHERE ir.invoice_item_id = ii.id), 0) AS returned_quantity,
      COALESCE((SELECT SUM(ir.total_credit) FROM invoice_returns ir WHERE ir.invoice_item_id = ii.id), 0) AS returned_total,
      MAX(ii.quantity - COALESCE((SELECT SUM(ir.quantity) FROM invoice_returns ir WHERE ir.invoice_item_id = ii.id), 0), 0) AS remaining_quantity
    FROM invoice_items ii WHERE ii.invoice_id = ? ORDER BY ii.rowid
  `).all(req.params.id);
  const payments = await db.prepare('SELECT * FROM payments WHERE invoice_id = ?').all(req.params.id);
  const creditMemos = await db.prepare("SELECT * FROM credit_memos WHERE invoice_id = ? AND status = 'issued' ORDER BY created_at DESC").all(req.params.id);
  const refunds = await db.prepare('SELECT * FROM refunds WHERE invoice_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...invoice as any, items, payments, credit_memos: creditMemos, refunds });
});

router.post('/', async (req: Request, res: Response) => {
  const db = getDb();
  if (req.user?.role === 'staff') {
    const openShift = await db.prepare("SELECT id FROM cashier_shifts WHERE user_id=? AND status='open' LIMIT 1").get(req.user.id);
    if (!openShift) { res.status(403).json({ error: 'Open staff shift required before making a sale' }); return; }
  }
  const { customer_id, items, due_date, tax_rate, issued_date, delivery_person, credit_account_name, buyer_address, notes, payment } = req.body;
  const creditName = typeof credit_account_name === 'string' ? credit_account_name.trim() : '';
  const buyerAddress = typeof buyer_address === 'string' ? buyer_address.trim() : '';
  const invoiceNotes = typeof notes === 'string' ? notes.trim() : '';

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'At least one line item is required' });
    return;
  }

  if (delivery_person !== undefined && delivery_person !== null && (typeof delivery_person !== 'string' || delivery_person.trim().length > 100)) {
    res.status(400).json({ error: 'Delivery person must be 100 characters or fewer' }); return;
  }
  if (credit_account_name !== undefined && credit_account_name !== null && (typeof credit_account_name !== 'string' || creditName.length > 120)) {
    res.status(400).json({ error: 'Credit account name must be 120 characters or fewer' }); return;
  }
  if (buyerAddress.length > 250) { res.status(400).json({ error: 'Buyer address must be 250 characters or fewer' }); return; }
  if (invoiceNotes.length > 250) { res.status(400).json({ error: 'Invoice notes must be 250 characters or fewer' }); return; }

  const usedMaterialIds = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.description || !item.description.trim()) {
      res.status(400).json({ error: `Item ${i + 1}: description is required` });
      return;
    }
    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      res.status(400).json({ error: `Item ${i + 1}: quantity must be greater than 0` });
      return;
    }
    if (typeof item.unit_price !== 'number' || !Number.isFinite(item.unit_price) || item.unit_price <= 0) {
      res.status(400).json({ error: `Item ${i + 1}: unit price must be greater than 0` });
      return;
    }
    if (item.material_id) {
      usedMaterialIds.add(item.material_id);
    }
  }

  if (customer_id) {
    const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
    if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }
  }

  // POS checkouts may include payment so invoice, stock, and payment commit together.
  // The Advanced Invoice Form intentionally omits this field for legitimate account invoices.
  const checkoutPayment = payment && typeof payment === 'object' ? payment : null;
  if (checkoutPayment) {
    const paymentMethod = typeof checkoutPayment.method === 'string' ? checkoutPayment.method.trim().toLowerCase() : '';
    const paymentAmount = checkoutPayment.amount;
    const validAmount = typeof paymentAmount === 'number' && Number.isFinite(paymentAmount) && (paymentMethod === 'credit' ? paymentAmount === 0 : paymentAmount > 0);
    if (!PAYMENT_METHODS.includes(paymentMethod) || !validAmount) {
      res.status(422).json({ error: 'A valid payment method and payment amount are required' }); return;
    }
    if (paymentMethod === 'credit' && !creditName) {
      res.status(400).json({ error: 'A buyer or charge-to name is required for credit sales' }); return;
    }
  }

  const invoiceId = uuidv4();

  const insertItem = db.prepare(
    'INSERT INTO invoice_items (id, invoice_id, material_id, description, quantity, unit_price, cost_price, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const deductStock = db.prepare('UPDATE materials SET stock = stock - ? WHERE id = ?');
  const getSeq = db.prepare('SELECT next_number FROM invoice_sequence WHERE id = 1');
  const updateSeq = db.prepare('UPDATE invoice_sequence SET next_number = next_number + 1 WHERE id = 1');
  let invoice_number = '';
  const insertMovement = db.prepare(
    'INSERT INTO stock_movements (id, material_id, type, quantity, reference_id, reference_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertPayment = db.prepare(
    'INSERT INTO payments (id, invoice_id, amount, method, notes, shift_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const paymentId = checkoutPayment ? uuidv4() : null;
  let materialMap = new Map<string, any>();

  const txn = db.transaction(async () => {
    const seq = await getSeq.get() as any;
    const num = seq.next_number;
    await updateSeq.run();
    invoice_number = `INV-${String(num).padStart(4, '0')}`;

    if (usedMaterialIds.size > 0) {
      const placeholders = Array.from(usedMaterialIds).map(() => '?').join(',');
      const mats = await db.prepare(`SELECT id, name, stock, unit, cost_price FROM materials WHERE id IN (${placeholders})`).all(...usedMaterialIds) as any[];
      materialMap = new Map(mats.map((m: any) => [m.id, m]));
      for (const materialId of usedMaterialIds) {
        const mat = materialMap.get(materialId);
        if (!mat) throw new Error(`Material ${materialId} not found`);
        const qtyNeeded = items.filter((it: any) => it.material_id === materialId).reduce((s: number, it: any) => s + it.quantity, 0);
        if (mat.stock < qtyNeeded) throw new Error(`Insufficient stock for ${mat.name}: have ${mat.stock} ${mat.unit}, need ${qtyNeeded} ${mat.unit}`);
      }
    }

    await     db.prepare(
      'INSERT INTO invoices (id, customer_id, invoice_number, subtotal, tax_rate, total, due_date, delivery_person, credit_account_name, buyer_address, notes, issued_date, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(invoiceId, customer_id || null, invoice_number, 0, tax_rate ?? 0, 0, due_date || null, delivery_person?.trim() || null, creditName || null, buyerAddress || null, invoiceNotes || null, issued_date || null, (req as any).user?.id || null);

    let subtotal = 0;
    for (const item of items) {
      const lineTotal = item.quantity * item.unit_price;
      subtotal += lineTotal;
      const cost = item.material_id ? Number(materialMap.get(item.material_id)?.cost_price || 0) : 0;
      await insertItem.run(uuidv4(), invoiceId, item.material_id || null, item.description.trim(), item.quantity, item.unit_price, cost, Math.round(lineTotal * 100) / 100);
    }

    const appliedTaxRate = tax_rate ?? Number((await db.prepare("SELECT value FROM settings WHERE key = 'default_tax_rate'").get() as any)?.value ?? 0);
    const roundedSubtotal = Math.round(subtotal * 100) / 100;
    const taxAmount = Math.round(roundedSubtotal * Number(appliedTaxRate) * 100) / 100;
    const total = Math.round((roundedSubtotal + taxAmount) * 100) / 100;

    await db.prepare('UPDATE invoices SET subtotal = ?, tax_rate = ?, tax_amount = ?, total = ? WHERE id = ?')
      .run(roundedSubtotal, appliedTaxRate, taxAmount, total, invoiceId);

    if (checkoutPayment) {
      const paymentMethod = checkoutPayment.method.trim().toLowerCase();
      if (paymentMethod === 'credit') {
        await db.prepare("UPDATE invoices SET status='pending' WHERE id=?").run(invoiceId);
      } else {
        const paymentAmount = Number(checkoutPayment.amount);
        if (Math.abs(paymentAmount - total) > 0.005) throw new Error('Payment amount must match the sale total');
        const activeShift = await db.prepare("SELECT id FROM cashier_shifts WHERE user_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1").get((req as any).user?.id) as any;
        if (!activeShift) throw new Error('Open a cashier shift before completing a paid sale');
        await insertPayment.run(paymentId, invoiceId, total, paymentMethod, checkoutPayment.notes || null, activeShift.id);
        await db.prepare("UPDATE invoices SET status='paid', paid_date=datetime('now') WHERE id=?").run(invoiceId);
      }
    }

    for (const materialId of usedMaterialIds) {
      const qtyNeeded = items
        .filter((it: any) => it.material_id === materialId)
        .reduce((s: number, it: any) => s + it.quantity, 0);
      await deductStock.run(qtyNeeded, materialId);
      await insertMovement.run(uuidv4(), materialId, 'sale', -qtyNeeded, invoiceId, 'invoice', `Sold in ${invoice_number}`);
    }
  });

  try {
    await txn();
    clearCache('analytics:');
    await logAudit((req as any).user?.id || null, 'create', 'invoice', invoiceId, `Created ${invoice_number}`);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  const invoice = await db.prepare(`
    SELECT i.*, COALESCE(c.name, 'Walk-in') AS customer_name
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?
  `).get(invoiceId);
  const invoiceItems = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId);
  const invoicePayments = await db.prepare('SELECT * FROM payments WHERE invoice_id = ?').all(invoiceId);
  res.status(201).json({ ...invoice as any, items: invoiceItems, payments: invoicePayments });
});

router.put('/:id/delivery', async (req: Request, res: Response) => {
  const db = getDb();
  const deliveryPerson = req.body?.delivery_person;
  if (deliveryPerson !== null && deliveryPerson !== undefined && (typeof deliveryPerson !== 'string' || deliveryPerson.trim().length > 100)) {
    res.status(400).json({ error: 'Delivery person must be 100 characters or fewer' }); return;
  }
  const invoice = await db.prepare('SELECT id, invoice_number, delivery_person FROM invoices WHERE id=?').get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
  const next = typeof deliveryPerson === 'string' ? deliveryPerson.trim() : '';
  const invoiceId = String(req.params.id);
  await db.prepare('UPDATE invoices SET delivery_person=? WHERE id=?').run(next || null, invoiceId);
  await logAudit((req as any).user?.id || null, 'update', 'invoice', invoiceId, `Delivery person updated for ${invoice.invoice_number}`, { delivery_person: invoice.delivery_person || null }, { delivery_person: next || null });
  res.json({ ok: true, delivery_person: next || null });
});

router.put('/:id/credit-account', async (req: Request, res: Response) => {
  const db = getDb();
  const name = typeof req.body?.credit_account_name === 'string' ? req.body.credit_account_name.trim() : '';
  if (!name || name.length > 120) { res.status(400).json({ error: 'Customer or account name is required and must be 120 characters or fewer' }); return; }
  const invoice = await db.prepare('SELECT id, invoice_number, credit_account_name FROM invoices WHERE id=?').get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
  await db.prepare('UPDATE invoices SET credit_account_name=? WHERE id=?').run(name, String(req.params.id));
  await logAudit((req as any).user?.id || null, 'update', 'invoice', String(req.params.id), `Credit account name updated for ${invoice.invoice_number}`, { credit_account_name: invoice.credit_account_name || null }, { credit_account_name: name });
  res.json({ ok: true, credit_account_name: name });
});

router.post('/:id/pay', async (req: Request, res: Response) => {
  const db = getDb();
  const { amount, method, notes } = req.body;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'Amount must be greater than 0' });
    return;
  }
  if (typeof method !== 'string' || !SETTLEMENT_METHODS.includes(method.trim().toLowerCase())) {
    res.status(400).json({ error: 'Payment method is required' });
    return;
  }
  const insertPayment = db.prepare(
    'INSERT INTO payments (id, invoice_id, amount, method, notes, shift_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const getTotalPaid = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as paid FROM payments WHERE invoice_id = ?'
  );
  const updateStatusPaid = db.prepare(
    "UPDATE invoices SET status = 'paid', paid_date = datetime('now') WHERE id = ?"
  );
  const updateStatusPartial = db.prepare(
    "UPDATE invoices SET status = 'partial' WHERE id = ?"
  );
  const getInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?');

  const paymentId = uuidv4();
  let invoiceBefore: any = null;

  try {
    const txn = db.transaction(async () => {
      const invoice = await getInvoice.get(req.params.id) as any;
      invoiceBefore = invoice ? { ...invoice } : null;
      if (!invoice) throw new Error('Invoice not found');
      if (invoice.status === 'voided') throw new Error('Cannot pay a voided invoice');
      const activeShift = await db.prepare("SELECT id FROM cashier_shifts WHERE user_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1").get((req as any).user?.id) as any;
      if (!activeShift) throw new Error('Open a cashier shift before recording a payment');

      const credits = (await db.prepare("SELECT COALESCE(SUM(amount),0) total FROM credit_memos WHERE invoice_id=? AND status='issued'").get(req.params.id) as any).total;
      const returnsCredit = (await db.prepare('SELECT COALESCE(SUM(total_credit),0) total FROM invoice_returns WHERE invoice_id=?').get(req.params.id) as any).total;
      const existingPaid = (await getTotalPaid.get(req.params.id) as any).paid - Number((await db.prepare('SELECT COALESCE(SUM(amount),0) total FROM refunds WHERE invoice_id=?').get(req.params.id) as any).total);
      const remainingBalance = Math.max(0, Number(invoice.total) - Number(credits) - Number(returnsCredit) - existingPaid);
      if (amount > remainingBalance + 0.005) {
        throw new Error(`Payment of ${amount} exceeds remaining balance of ${remainingBalance}`);
      }

      await insertPayment.run(paymentId, req.params.id, amount, method, notes || null, activeShift.id);
      const totalPaid = existingPaid + amount;

      if (totalPaid >= Number(invoice.total) - Number(credits) - Number(returnsCredit)) {
        await updateStatusPaid.run(req.params.id);
      } else if (totalPaid > 0) {
        await updateStatusPartial.run(req.params.id);
      }
      const invoiceAfter = await getInvoice.get(req.params.id);
      await logAudit((req as any).user?.id || null, 'update', 'invoice', req.params.id as string, `Payment of ${amount} via ${method}`, invoiceBefore, invoiceAfter);
    });
    await txn();
    clearCache('analytics:');
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  res.status(201).json(await db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId));
});

// Issued invoices are never hard-deleted. Voiding preserves the audit trail and restores
// only the quantity that has not already been returned.
router.put('/:id/void', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
  if (invoice.status === 'voided' || invoice.voided_at) { res.status(409).json({ error: 'Invoice is already voided' }); return; }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 3) { res.status(400).json({ error: 'A void reason is required' }); return; }
  const txn = db.transaction(async () => {
    const items = await db.prepare(`SELECT ii.material_id, ii.quantity,
      COALESCE((SELECT SUM(quantity) FROM invoice_returns ir WHERE ir.invoice_item_id = ii.id), 0) returned
      FROM invoice_items ii WHERE ii.invoice_id = ?`).all(invoice.id) as any[];
    for (const item of items) {
      const restorable = Math.max(0, Number(item.quantity) - Number(item.returned));
      if (item.material_id && restorable > 0) {
        await db.prepare('UPDATE materials SET stock = stock + ? WHERE id = ?').run(restorable, item.material_id);
        await db.prepare('INSERT INTO stock_movements (id, material_id, type, quantity, reference_id, reference_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(uuidv4(), item.material_id, 'void', restorable, invoice.id, 'invoice', `Restored from voided ${invoice.invoice_number}`);
      }
    }
    await db.prepare("UPDATE invoices SET status = 'voided', voided_at = datetime('now'), voided_by = ?, void_reason = ? WHERE id = ?")
      .run((req as any).user?.id || null, reason, invoice.id);
  });
  try { await txn(); } catch (e: any) { res.status(400).json({ error: e.message }); return; }
  clearCache('analytics:');
  await logAudit((req as any).user?.id || null, 'void', 'invoice', invoice.id, `Voided ${invoice.invoice_number}: ${reason}`, invoice, { ...invoice, status: 'voided', void_reason: reason });
  res.json(await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id));
});

router.post('/:id/credit-memo', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
  if (invoice.status === 'voided') { res.status(400).json({ error: 'Cannot adjust a voided invoice' }); return; }
  const amount = Number(req.body?.amount);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const existingCredit = (await db.prepare("SELECT COALESCE(SUM(amount),0) total FROM credit_memos WHERE invoice_id=? AND status='issued'").get(invoice.id) as any).total;
  const existingReturns = (await db.prepare("SELECT COALESCE(SUM(total_credit),0) total FROM invoice_returns WHERE invoice_id=?").get(invoice.id) as any).total;
  const remainingValue = Math.max(0, Number(invoice.total) - Number(existingCredit) - Number(existingReturns));
  if (!Number.isFinite(amount) || amount <= 0 || amount > remainingValue + 0.005) { res.status(400).json({ error: 'Credit amount must be greater than zero and no more than the remaining invoice value' }); return; }
  if (reason.length < 3) { res.status(400).json({ error: 'A credit memo reason is required' }); return; }
  const id = uuidv4();
  const number = `CM-${Date.now().toString().slice(-8)}`;
  const creditAmount = Math.round(amount * 100) / 100;
  const creditTax = Number(invoice.tax_rate) > 0 ? Math.round((creditAmount * Number(invoice.tax_rate) / (1 + Number(invoice.tax_rate))) * 100) / 100 : 0;
  const createCreditMemo = db.transaction(async () => {
    const current = await db.prepare('SELECT status, total FROM invoices WHERE id=?').get(invoice.id) as any;
    const used = await db.prepare("SELECT COALESCE(SUM(amount),0) total FROM credit_memos WHERE invoice_id=? AND status='issued'").get(invoice.id) as any;
    const returned = await db.prepare("SELECT COALESCE(SUM(total_credit),0) total FROM invoice_returns WHERE invoice_id=?").get(invoice.id) as any;
    if (!current || current.status === 'voided') throw new Error('Cannot adjust a voided or missing invoice');
    if (creditAmount > Math.max(0, Number(current.total) - Number(used.total) - Number(returned.total)) + 0.005) throw new Error('Credit amount exceeds remaining invoice value');
    await db.prepare('INSERT INTO credit_memos (id, invoice_id, memo_number, reason, amount, tax_amount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, invoice.id, number, reason, creditAmount, creditTax, (req as any).user?.id || null);
    await refreshInvoiceStatus(db, invoice.id);
    await logAudit((req as any).user?.id || null, 'create', 'credit_memo', id, `${number} for ${invoice.invoice_number}: ${reason}`, null, { invoice_id: invoice.id, memo_number: number, amount: creditAmount, tax_amount: creditTax, reason });
  });
  try { await createCreditMemo(); } catch (e: any) { res.status(409).json({ error: e.message }); return; }
  res.status(201).json(await db.prepare('SELECT * FROM credit_memos WHERE id = ?').get(id));
});

router.post('/:id/refund', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  const amount = Number(req.body?.amount);
  const method = typeof req.body?.method === 'string' ? req.body.method.trim() : '';
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
  if (!Number.isFinite(amount) || amount <= 0 || !REFUND_METHODS.includes(method.toLowerCase())) { res.status(400).json({ error: 'Valid refund amount and method are required' }); return; }
  let shiftId: string | null = null;
  if (method.toLowerCase() === 'cash') {
    const requestedShiftId = typeof req.body?.shift_id === 'string' ? req.body.shift_id : '';
    const shift = requestedShiftId
      ? await db.prepare("SELECT id FROM cashier_shifts WHERE id=? AND status='open'").get(requestedShiftId) as any
      : await db.prepare("SELECT cs.id FROM cashier_shifts cs JOIN payments p ON p.shift_id=cs.id WHERE p.invoice_id=? AND p.method='cash' AND cs.status='open' ORDER BY cs.opened_at DESC LIMIT 1").get(invoice.id) as any;
    if (!shift) { res.status(409).json({ error: 'Select an active cashier shift for a cash refund' }); return; }
    shiftId = shift.id;
  }
  const id = uuidv4();
  const createRefund = db.transaction(async () => {
    const current = await db.prepare('SELECT status FROM invoices WHERE id=?').get(invoice.id) as any;
    const paid = await db.prepare('SELECT COALESCE(SUM(amount),0) total FROM payments WHERE invoice_id=?').get(invoice.id) as any;
    const refunded = await db.prepare('SELECT COALESCE(SUM(amount),0) total FROM refunds WHERE invoice_id=?').get(invoice.id) as any;
    const availableRefund = Number(paid.total) - Number(refunded.total);
    if (!current || current.status === 'voided') throw new Error('Cannot refund a voided or missing invoice');
    if (amount > availableRefund + 0.005) throw new Error('Refund exceeds unapplied payments');
    await db.prepare('INSERT INTO refunds (id, invoice_id, amount, method, reference, created_by, shift_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, invoice.id, amount, method, req.body?.reference || null, (req as any).user?.id || null, shiftId);
    await refreshInvoiceStatus(db, invoice.id);
    await logAudit((req as any).user?.id || null, 'create', 'refund', id, `Refund ${amount} via ${method} for ${invoice.invoice_number}`, null, { invoice_id: invoice.id, amount, method, shift_id: shiftId });
  });
  try { await createRefund(); } catch (e: any) { res.status(409).json({ error: e.message }); return; }
  res.status(201).json(await db.prepare('SELECT * FROM refunds WHERE id = ?').get(id));
});

router.post('/:id/return', async (req: Request, res: Response) => {
  const db = getDb();
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'At least one return item is required' });
    return;
  }

  const invoiceId = req.params.id as string;
    const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
  if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }
  if (inv.status === 'voided') { res.status(400).json({ error: 'Cannot return items on a voided invoice' }); return; }
  if (inv.status === 'pending') {
    res.status(400).json({ error: 'Cannot return items on an unpaid invoice — delete it instead' });
    return;
  }

  const requested = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.material_id) { res.status(400).json({ error: `Return item ${i + 1}: material is required` }); return; }
    if (!item.quantity || item.quantity <= 0) { res.status(400).json({ error: `Return item ${i + 1}: quantity must be > 0` }); return; }

    const lineItem = await db.prepare('SELECT * FROM invoice_items WHERE id = ? AND invoice_id = ? AND material_id = ?')
      .get(item.invoice_item_id || '', invoiceId, item.material_id) as any;
    const itemKey = lineItem?.id || item.material_id;
    requested.set(itemKey, (requested.get(itemKey) || 0) + item.quantity);
    if (!lineItem) { res.status(400).json({ error: `Material not found on this invoice` }); return; }
    const returned = (await db.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM invoice_returns WHERE invoice_item_id = ?').get(lineItem.id) as any).total;
    if (requested.get(itemKey)! + returned > lineItem.quantity) {
      res.status(400).json({ error: `Cannot return more than purchased (${lineItem.quantity})` });
      return;
    }
  }

  const restoreStock = db.prepare('UPDATE materials SET stock = stock + ? WHERE id = ?');
  const insertMovement = db.prepare(
    'INSERT INTO stock_movements (id, material_id, type, quantity, reference_id, reference_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const txn = db.transaction(async () => {
    for (const item of items) {
      const lineItem = await db.prepare('SELECT id, unit_price FROM invoice_items WHERE id = ? AND invoice_id = ?').get(item.invoice_item_id || '', invoiceId) as any;
      const totalCredit = Math.round(Number(lineItem.unit_price) * Number(item.quantity) * (1 + Number(inv.tax_rate || 0)) * 100) / 100;
      await db.prepare('INSERT INTO invoice_returns (id, invoice_item_id, invoice_id, material_id, quantity, total_credit) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), lineItem.id, invoiceId, item.material_id, item.quantity, totalCredit);
      await restoreStock.run(item.quantity, item.material_id);
      await insertMovement.run(uuidv4(), item.material_id, 'return', item.quantity, invoiceId, 'invoice', `Returned from ${inv.invoice_number}`);
    }

    await refreshInvoiceStatus(db, invoiceId);
  });

  await txn();
  clearCache('analytics:');
  res.json(await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId));
});

router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }
  const paymentCount = await db.prepare('SELECT COUNT(*) AS count FROM payments WHERE invoice_id = ?').get(req.params.id) as any;
  if (existing.status !== 'pending' || Number(paymentCount.count) > 0) {
    res.status(409).json({ error: 'Issued invoices cannot be deleted. Void the invoice instead.' }); return;
  }

  const insertMovement = db.prepare(
    'INSERT INTO stock_movements (id, material_id, type, quantity, reference_id, reference_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const txn = db.transaction(async () => {
    const items = await db.prepare(`SELECT ii.material_id, ii.quantity,
      COALESCE((SELECT SUM(quantity) FROM invoice_returns ir WHERE ir.invoice_item_id = ii.id), 0) AS returned
      FROM invoice_items ii WHERE ii.invoice_id = ?`).all(req.params.id) as any[];
    for (const item of items) {
      if (item.material_id) {
        const restorable = Math.max(0, item.quantity - item.returned);
        await db.prepare('UPDATE materials SET stock = stock + ? WHERE id = ?').run(restorable, item.material_id);
        if (restorable > 0) await insertMovement.run(uuidv4(), item.material_id, 'sale', restorable, req.params.id, 'invoice', `Restored from deleted invoice ${existing.invoice_number}`);
      }
    }
    await db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM invoice_returns WHERE invoice_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  });
  await txn();
  clearCache('analytics:');
  await logAudit((req as any).user?.id || null, 'delete', 'invoice', req.params.id as string, `Deleted ${existing.invoice_number}`);
  res.status(204).end();
});

export default router;
