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
    SELECT a.id, a.user_id, a.attendance_date, a.status, n.remarks
    FROM attendance a JOIN users u ON u.id=a.user_id
    LEFT JOIN attendance_notes n ON n.user_id=a.user_id AND n.attendance_date=a.attendance_date
    WHERE u.role='staff' AND a.attendance_date >= ? AND a.attendance_date < date(?, '+1 month')
      AND (? = '' OR a.user_id = ?)
    ORDER BY a.attendance_date ASC
  `).all(`${month}-01`, `${month}-01`, userId, userId);
  const notes = await db.prepare(`SELECT n.user_id, n.attendance_date, n.remarks FROM attendance_notes n JOIN users u ON u.id=n.user_id WHERE u.role='staff' AND n.attendance_date >= ? AND n.attendance_date < date(?, '+1 month') AND (? = '' OR n.user_id = ?) ORDER BY n.attendance_date ASC`).all(`${month}-01`, `${month}-01`, userId, userId);
  res.json({ month, staff, records, notes });
});

router.put('/remark', async (req: Request, res: Response) => {
  const db = getDb();
  const userId = typeof req.body?.user_id === 'string' ? req.body.user_id : '';
  const attendanceDate = req.body?.date;
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim() : '';
  if (!userId || !validDate(attendanceDate) || remarks.length > 250) { res.status(400).json({ error: 'Staff, valid date, and remarks up to 250 characters are required' }); return; }
  const staff = await db.prepare("SELECT id, username FROM users WHERE id=? AND role='staff'").get(userId) as any;
  if (!staff) { res.status(404).json({ error: 'Staff member not found' }); return; }
  const existing = await db.prepare('SELECT id, remarks FROM attendance_notes WHERE user_id=? AND attendance_date=?').get(userId, attendanceDate) as any;
  if (existing) await db.prepare("UPDATE attendance_notes SET remarks=?, updated_at=datetime('now') WHERE id=?").run(remarks, existing.id);
  else await db.prepare('INSERT INTO attendance_notes (id,user_id,attendance_date,remarks) VALUES (?,?,?,?)').run(uuidv4(), userId, attendanceDate, remarks);
  await logAudit((req as any).user?.id || null, existing ? 'update' : 'create', 'attendance_note', existing?.id || `${userId}:${attendanceDate}`, `${staff.username} updated attendance remarks for ${attendanceDate}`, existing ? { remarks: existing.remarks } : null, { user_id: userId, date: attendanceDate, remarks });
  res.json({ user_id: userId, attendance_date: attendanceDate, remarks });
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
