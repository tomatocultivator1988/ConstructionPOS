import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();
router.use(requireAdmin);

function validateSupplier(body: any, existing?: any) {
  const errors: string[] = [];
  const name = body.name ?? existing?.name;

  if (body.name !== undefined && (!body.name || !body.name.trim())) {
    errors.push('Name is required');
  }
  if (body.phone !== undefined && body.phone && !/^\d{7,13}$/.test(body.phone)) {
    errors.push('Phone must be 7-13 digits');
  }
  if (body.email !== undefined && body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    errors.push('Invalid email format');
  }
  return {
    name: name,
    contact_person: body.contact_person ?? existing?.contact_person ?? null,
    phone: body.phone !== undefined ? body.phone || null : existing?.phone ?? null,
    email: body.email !== undefined ? body.email || null : existing?.email ?? null,
    address: body.address !== undefined ? body.address || null : existing?.address ?? null,
    tin: body.tin !== undefined ? body.tin || null : existing?.tin ?? null,
    notes: body.notes !== undefined ? body.notes || null : existing?.notes ?? null,
    errors
  };
}

router.get('/', async (req: Request, res: Response) => {
  const db = getDb();
  const conditions: string[] = []; const params: any[] = [];
  if (typeof req.query.from === 'string' && req.query.from) { conditions.push('date(created_at) >= ?'); params.push(req.query.from); }
  if (typeof req.query.to === 'string' && req.query.to) { conditions.push('date(created_at) <= ?'); params.push(req.query.to); }
  const suppliers = await db.prepare(`SELECT * FROM suppliers${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY name ASC`).all(...params);
  res.json(suppliers);
});

router.get('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const supplier = await db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }
  res.json(supplier);
});

router.post('/', async (req: Request, res: Response) => {
  const db = getDb();
  const v = validateSupplier(req.body);
  if (v.errors.length) {
    res.status(400).json({ error: v.errors.join('; ') });
    return;
  }
  const id = uuidv4();
  await db.prepare(
    'INSERT INTO suppliers (id, name, contact_person, phone, email, address, tin, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, v.name.trim(), v.contact_person, v.phone, v.email, v.address, v.tin, v.notes);
  const supplier = await db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  await logAudit((req as any).user?.id || null, 'create', 'supplier', id, v.name, null, supplier);
  res.status(201).json(supplier);
});

router.put('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Supplier not found' }); return; }
  const v = validateSupplier(req.body, existing);
  if (v.errors.length) {
    res.status(400).json({ error: v.errors.join('; ') });
    return;
  }
  await db.prepare(
    'UPDATE suppliers SET name=?, contact_person=?, phone=?, email=?, address=?, tin=?, notes=? WHERE id=?'
  ).run(v.name.trim(), v.contact_person, v.phone, v.email, v.address, v.tin, v.notes, req.params.id);
  const updated = await db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  await logAudit((req as any).user?.id || null, 'update', 'supplier', req.params.id as string, undefined, existing, updated);
  res.json(updated);
});

router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Supplier not found' }); return; }
  const name = (existing as any).name;
  await db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
  await logAudit((req as any).user?.id || null, 'delete', 'supplier', req.params.id as string, name, existing, null);
  res.status(204).send();
});

export default router;
