import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();
router.use(requireAdmin);

function validMonth(value: unknown) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function validDate(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

router.get('/', async (req: Request, res: Response) => {
  const db = getDb();
  const month = validMonth(req.query.month) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
  const userId = typeof req.query.user_id === 'string' ? req.query.user_id : '';
  const staff = await db.prepare("SELECT id, username FROM users WHERE role='staff' ORDER BY username COLLATE NOCASE").all();
  const records = await db.prepare(`
    SELECT a.id, a.user_id, a.attendance_date, a.status
    FROM attendance a JOIN users u ON u.id=a.user_id
    WHERE u.role='staff' AND a.attendance_date >= ? AND a.attendance_date < date(?, '+1 month')
      AND (? = '' OR a.user_id = ?)
    ORDER BY a.attendance_date ASC
  `).all(`${month}-01`, `${month}-01`, userId, userId);
  res.json({ month, staff, records });
});

router.put('/', async (req: Request, res: Response) => {
  const db = getDb();
  const userId = typeof req.body?.user_id === 'string' ? req.body.user_id : '';
  const attendanceDate = req.body?.date;
  const status = req.body?.status;
  if (!userId || !validDate(attendanceDate) || !['present', 'absent'].includes(status)) {
    res.status(400).json({ error: 'Staff, valid date, and status (present or absent) are required' });
    return;
  }
  const staff = await db.prepare("SELECT id, username FROM users WHERE id=? AND role='staff'").get(userId) as any;
  if (!staff) { res.status(404).json({ error: 'Staff member not found' }); return; }
  const existing = await db.prepare('SELECT status FROM attendance WHERE user_id=? AND attendance_date=?').get(userId, attendanceDate) as any;
  const id = existing ? undefined : uuidv4();
  if (existing) {
    await db.prepare("UPDATE attendance SET status=?, updated_at=datetime('now') WHERE user_id=? AND attendance_date=?").run(status, userId, attendanceDate);
  } else {
    await db.prepare('INSERT INTO attendance (id, user_id, attendance_date, status) VALUES (?, ?, ?, ?)').run(id, userId, attendanceDate, status);
  }
  await logAudit((req as any).user?.id || null, existing ? 'update' : 'create', 'attendance', id || `${userId}:${attendanceDate}`, `${staff.username} marked ${status} for ${attendanceDate}`, existing ? { status: existing.status } : null, { user_id: userId, date: attendanceDate, status });
  res.json(await db.prepare('SELECT id, user_id, attendance_date, status FROM attendance WHERE user_id=? AND attendance_date=?').get(userId, attendanceDate));
});

export default router;
