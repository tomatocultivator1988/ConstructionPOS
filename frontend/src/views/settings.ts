import { apiGet, apiPut, apiPost, apiDel } from '../lib/api';
import { esc, val, setErr, clearErr, disableBtn, fmtDate, fmtPeso, isAdmin } from '../lib/helpers';
import { showToast, showConfirmModal, showModal, closeModal } from '../lib/helpers';
import { printShift } from './receipt';

let settingsSubTab = 'general';

export async function renderSettings(): Promise<string> {
  const isAdm = isAdmin();
  return `
    <div class="page-header">
      <h2>Settings</h2>
      <button class="btn btn-danger btn-sm" onclick="logout()">Logout</button>
    </div>
    <div style="display:flex;gap:2px;background:var(--c-bg);padding:3px;border-radius:var(--radius-md);margin-bottom:var(--space-5);width:fit-content">
      <button class="nav-btn ${settingsSubTab === 'general' ? 'active' : ''}" onclick="switchSettingsTab('general')">General</button>
      ${isAdm ? `<button class="nav-btn ${settingsSubTab === 'users' ? 'active' : ''}" onclick="switchSettingsTab('users')">Staff</button>` : ''}
      ${isAdm ? `<button class="nav-btn ${settingsSubTab === 'audit' ? 'active' : ''}" onclick="switchSettingsTab('audit')">Audit Log</button>` : ''}
      <button class="nav-btn ${settingsSubTab === 'shift' ? 'active' : ''}" onclick="switchSettingsTab('shift')">Cashier Shift</button>
    </div>
    <div id="settings-content">${await loadGeneralSettings()}</div>
  `;
}

export async function switchSettingsTab(tab: string) {
  settingsSubTab = tab;
  const el = document.getElementById('settings-content');
  if (!el) return;
  if (tab === 'general') el.innerHTML = await loadGeneralSettings();
  else if (tab === 'users') el.innerHTML = await loadUsersTab();
  else if (tab === 'audit') el.innerHTML = await loadAuditTab();
  else if (tab === 'shift') el.innerHTML = await loadShiftTab();
}

async function loadShiftTab() {
  const [users, active, history] = await Promise.all([apiGet<any[]>('/users'), apiGet<any[]>('/shifts/active'), apiGet<any[]>('/shifts/history')]);
  const shift = active[0];
  const drawerAdjustment = Number(shift?.drawer_events || 0);
  const historyHtml = `<div class="settings-card shift-history-card"><h3>Recorded Shifts</h3>${history.length ? `<div class="table-wrap"><table><thead><tr><th>Opened</th><th>Closed</th><th>Cashier</th><th>Expected</th><th>Counted</th><th>Variance</th><th class="actions">Actions</th></tr></thead><tbody>${history.map((row: any) => { const variance = Number(row.variance || 0); return `<tr><td data-label="Opened">${esc(fmtDate(row.opened_at))}</td><td data-label="Closed">${esc(fmtDate(row.closed_at))}</td><td data-label="Cashier">${esc(row.username || '—')}</td><td data-label="Expected" class="money">${fmtPeso(row.expected_cash)}</td><td data-label="Counted" class="money">${fmtPeso(row.closing_cash)}</td><td data-label="Variance" class="money ${variance === 0 ? 'positive' : variance > 0 ? 'warning-value' : 'negative'}">${variance >= 0 ? '+' : '−'}${fmtPeso(Math.abs(variance))}</td><td data-label="" class="actions"><button class="btn btn-sm" onclick="showShiftPreview('${row.id}')">View</button><button class="btn btn-primary btn-sm" onclick="printShift('${row.id}')">Print Thermal</button></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="empty-state">No closed shifts recorded yet.</p>'}</div>`;
  const openCards = active.length ? active.map((s: any) => `<div class="shift-active-row"><strong>${esc(s.username)}</strong><span>Opened ${esc(fmtDate(s.opened_at))}</span><b>Expected ${fmtPeso(s.expected_cash)}</b><div class="shift-active-actions"><button class="btn btn-sm" onclick="showCashEventModal('${s.id}','cash_in')">Cash In</button><button class="btn btn-sm" onclick="showCashEventModal('${s.id}','cash_out')">Cash Out</button><button class="btn btn-warning btn-sm" onclick="showCloseStaffShift('${s.id}', ${Number(s.expected_cash)})">Close Shift</button></div></div>`).join('') : '<p class="empty-state">No staff shifts are currently open.</p>';
  return `<div class="settings-card"><h3>Open Staff Shift</h3><p class="card-sub">Only Admin can open, adjust, and close staff shifts.</p><div class="form-row"><div class="form-group"><label>Staff member *</label><select id="shift-staff"><option value="">Select staff...</option>${users.filter((u: any) => u.role === 'staff' && !active.some((s: any) => s.user_id === u.id)).map((u: any) => `<option value="${u.id}">${esc(u.username)}</option>`).join('')}</select></div><div class="form-group"><label>Opening cash</label><input id="shift-opening" type="number" min="0" step="0.01" value="0" /></div></div><button class="btn btn-primary" onclick="openCashierShift()">Open Staff Shift</button></div><div class="settings-card"><h3>Active Staff Shifts</h3>${openCards}</div>${historyHtml}`;
}

export async function showShiftPreview(id: string) {
  try {
    const shift = await apiGet<any>(`/shifts/${id}`);
    const variance = Number(shift.variance || 0);
    const methods = shift.payment_methods || {};
    const refunds = shift.refund_methods || {};
    const methodRows = [['Cash', methods.cash], ['GCash', methods.gcash], ['Card', methods.card], ['Bank Transfer', methods.bank], ['Check', methods.check], ['Total Collections', shift.total_collections]];
    const refundRows = [['Cash', refunds.cash], ['GCash', refunds.gcash], ['Card', refunds.card], ['Bank Transfer', refunds.bank], ['Check', refunds.check]];
    const rows = (items: any[][]) => items.map(([label, amount]) => `<dt>${label}</dt><dd>${fmtPeso(amount)}</dd>`).join('');
    showModal(`<div class="shift-preview"><div class="receipt-preview-heading"><div><span class="help-eyebrow">Shift Report Preview</span><h3>${esc(shift.username || 'Cashier Shift')}</h3></div><button class="help-close" onclick="closeModal()" aria-label="Close">×</button></div><div class="shift-preview-paper"><div class="shift-paper-header"><strong>JEG ENTERPRISES</strong><span>CASHIER SHIFT REPORT</span></div><dl><dt>Cashier</dt><dd>${esc(shift.username || '—')}</dd><dt>Opened</dt><dd>${esc(fmtDate(shift.opened_at))}</dd><dt>Closed</dt><dd>${esc(fmtDate(shift.closed_at))}</dd></dl><div class="shift-paper-section">CASH DRAWER</div><dl><dt>Opening Cash</dt><dd>${fmtPeso(shift.opening_cash)}</dd><dt>Cash Sales</dt><dd>${fmtPeso(shift.cash_sales)}</dd><dt>Cash Refunds</dt><dd>${fmtPeso(shift.cash_refunds)}</dd><dt>Drawer Adjustments</dt><dd>${fmtPeso(shift.drawer_events)}</dd></dl><div class="shift-paper-section">PAYMENT METHODS</div><dl>${rows(methodRows)}</dl><div class="shift-paper-section">REFUNDS BY METHOD</div><dl>${rows(refundRows)}</dl><div class="shift-paper-section">RECONCILIATION</div><dl><dt>Expected Cash</dt><dd>${fmtPeso(shift.expected_cash)}</dd><dt>Counted Cash</dt><dd>${fmtPeso(shift.closing_cash)}</dd><dt>Variance</dt><dd class="${variance === 0 ? 'positive' : variance > 0 ? 'warning-value' : 'negative'}">${variance >= 0 ? '+' : '−'}${fmtPeso(Math.abs(variance))}</dd></dl><p><strong>Notes:</strong> ${esc(shift.notes || '—')}</p><div class="shift-paper-footer">— End of Shift —</div></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button><button class="btn btn-primary" onclick="printShift('${id}')">Print Thermal</button></div></div>`, 'shift-preview-modal');
  } catch (e: any) { showToast(e?.message || 'Unable to load shift preview'); }
}

export function updateShiftVariance(expected: number) {
  const counted = Number(val('shift-closing'));
  const target = document.getElementById('shift-variance');
  if (!target || !Number.isFinite(counted) || counted < 0) return;
  const variance = counted - expected;
  target.textContent = `${variance >= 0 ? 'Over' : 'Short'} by ${fmtPeso(Math.abs(variance))}`;
  target.className = `shift-variance ${variance === 0 ? 'balanced' : variance > 0 ? 'over' : 'short'}`;
}

export async function openCashierShift() {
  const opening_cash = Number(val('shift-opening'));
  const user_id = val('shift-staff');
  try { await apiPost('/shifts/open', { user_id, opening_cash }); switchSettingsTab('shift'); showToast('Staff shift opened', 'success'); } catch (e: any) { showToast(e.message); }
}

export function showCloseStaffShift(id: string, expected: number) {
  showModal(`<h3>Close Staff Shift</h3><p class="modal-help">Expected cash: <strong>${fmtPeso(expected)}</strong></p><div class="form-group"><label>Counted closing cash *</label><input id="admin-shift-closing" type="number" min="0" step="0.01" value="${expected.toFixed(2)}" /></div><div class="form-group"><label>Notes</label><input id="admin-shift-notes" maxlength="200" /></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-warning" onclick="closeStaffShift('${id}')">Close Shift</button></div>`, 'close-staff-shift-modal');
}

export function showCashEventModal(id: string, type: string) {
  const label = type === 'cash_in' ? 'Cash In' : 'Cash Out';
  showModal(`<h3>${label}</h3><div class="form-group"><label>Amount *</label><input id="admin-shift-event-amount" type="number" min="0.01" step="0.01" /></div><div class="form-group"><label>Reason *</label><input id="admin-shift-event-reason" maxlength="200" placeholder="Enter reason" /></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitCashEvent('${id}','${type}')">Save</button></div>`, 'cash-event-modal');
}

export async function submitCashEvent(id: string, type: string) {
  const amount = Number(val('admin-shift-event-amount')); const reason = val('admin-shift-event-reason').trim();
  try { await apiPost(`/shifts/${id}/event`, { amount, type, reason }); closeModal(); switchSettingsTab('shift'); showToast(type === 'cash_in' ? 'Cash in recorded' : 'Cash out recorded', 'success'); } catch (e: any) { showToast(e.message); }
}

export async function closeStaffShift(id: string) {
  const closing_cash = Number(val('admin-shift-closing'));
  try { await apiPost(`/shifts/${id}/close`, { closing_cash, notes: val('admin-shift-notes') }); closeModal(); switchSettingsTab('shift'); showToast('Staff shift closed', 'success'); } catch (e: any) { showToast(e.message); }
}

export async function closeCashierShift(id: string) {
  const closing_cash = Number(val('shift-closing'));
  try { await apiPost(`/shifts/${id}/close`, { closing_cash, notes: val('shift-notes') }); switchSettingsTab('shift'); showToast('Shift closed', 'success'); } catch (e: any) { showToast(e.message); }
}

export async function recordCashEvent(id: string, type: string) {
  const amount = Number(val('shift-event-amount')); const reason = val('shift-event-reason').trim();
  try { await apiPost(`/shifts/${id}/event`, { amount, type, reason }); switchSettingsTab('shift'); showToast(type === 'cash_in' ? 'Cash in recorded' : 'Cash out recorded', 'success'); } catch (e: any) { showToast(e.message); }
}

async function loadGeneralSettings() {
  const keys = ['default_tax_rate','business_name','business_address','business_tin','business_rdo','vat_registered'];
  const values = await apiGet<Record<string, string>>(`/settings?keys=${keys.join(',')}`);
  return `
    <div class="settings-card">
      <h3 style="margin-bottom:var(--space-4)">Business & Invoice Profile</h3>
      <div class="form-row">
        <div class="form-group"><label>Registered business name</label><input id="s-business-name" value="${esc(values.business_name)}" maxlength="150" /></div>
        <div class="form-group"><label>TIN</label><input id="s-business-tin" value="${esc(values.business_tin)}" maxlength="20" placeholder="000-000-000-000" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Registered address</label><input id="s-business-address" value="${esc(values.business_address)}" maxlength="250" /></div>
        <div class="form-group"><label>RDO / branch code</label><input id="s-business-rdo" value="${esc(values.business_rdo)}" maxlength="30" /></div>
      </div>
      <div class="form-group"><label>VAT registered</label><select id="s-vat"><option value="0" ${values.vat_registered !== '1' ? 'selected' : ''}>No / non-VAT</option><option value="1" ${values.vat_registered === '1' ? 'selected' : ''}>Yes / VAT</option></select></div>
      <h3 style="margin:var(--space-5) 0 var(--space-4)">Invoice Defaults</h3>
      <div class="form-group">
        <label>Default Tax Rate</label>
        <input id="s-tax" type="number" step="0.01" min="0" max="1" value="${values.default_tax_rate || '0'}" />
        <div class="helper">Decimal value (0.12 = 12%). Applied to new invoices by default.</div>
        <div class="field-error" id="s-tax-err"></div>
      </div>
      <button class="btn btn-primary" id="s-save-btn" onclick="saveSettings()">Save Settings</button>
    </div>
  `;
}

export async function saveSettings() {
  clearErr('s-tax-err');
  const tax = parseFloat(val('s-tax'));
  if (isNaN(tax) || tax < 0 || tax > 1) { setErr('s-tax-err', 'Enter a valid rate between 0 and 1'); return; }
  disableBtn('s-save-btn', true);
  try {
    await Promise.all([
      apiPut('/settings/default_tax_rate', { value: String(tax) }),
      apiPut('/settings/business_name', { value: val('s-business-name').trim() }),
      apiPut('/settings/business_address', { value: val('s-business-address').trim() }),
      apiPut('/settings/business_tin', { value: val('s-business-tin').trim() }),
      apiPut('/settings/business_rdo', { value: val('s-business-rdo').trim() }),
      apiPut('/settings/vat_registered', { value: val('s-vat') }),
    ]);
    const label = document.querySelector('#s-save-btn')!;
    label.textContent = 'Saved';
    setTimeout(() => { label.textContent = 'Save Settings'; }, 2000);
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('s-save-btn', false); }
}

// ─── Staff accounts ───
async function loadUsersTab() {
  const users = await apiGet<any[]>('/users');
  return `
    <div class="page-header" style="margin-bottom:var(--space-4)">
      <div><h3>Staff</h3><p class="card-sub">${users.length} staff account${users.length === 1 ? '' : 's'} available</p></div>
      <button class="btn btn-primary" onclick="showUserModal()">+ Add Staff</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Username</th><th>Role</th><th>Created</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${users.map((u: any) => `
            <tr>
              <td data-label="Username" style="font-weight:600">${esc(u.username)}</td>
              <td data-label="Role"><span class="status-badge" style="background:${u.role === 'admin' ? 'var(--c-primary-bg)' : 'var(--c-success-bg)'};color:${u.role === 'admin' ? 'var(--c-primary)' : 'var(--c-success)'}">${u.role}</span></td>
              <td data-label="Created">${fmtDate(u.created_at)}</td>
              <td data-label="" class="actions">
                <button class="btn btn-primary btn-sm" onclick="showUserModal('${u.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="delUser('${u.id}')">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

export async function showUserModal(id?: string) {
  let data: any = null;
  if (id) {
    const users = await apiGet<any[]>('/users');
    data = users.find(u => u.id === id);
  }
  const isEdit = !!data;
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Staff</h3>
    <div class="form-group"><label>Username *</label><input id="uf-user" maxlength="50" value="${esc(data?.username || '')}" ${isEdit ? 'disabled' : ''} /><div class="field-error" id="uf-user-err"></div></div>
    <div class="form-row">
      <div class="form-group"><label>${isEdit ? 'New PIN (leave blank to keep)' : 'PIN *'}</label><input id="uf-pin" type="password" maxlength="6" placeholder="4-6 digits" /><div class="field-error" id="uf-pin-err"></div></div>
      <div class="form-group"><label>Role</label>
        <select id="uf-role"><option value="staff" ${data?.role === 'staff' ? 'selected' : ''}>Staff</option><option value="admin" ${data?.role === 'admin' ? 'selected' : ''}>Admin</option></select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="uf-save-btn" onclick="${isEdit ? `updateUser('${id}')` : 'createUser()'}">Save</button>
    </div>
  `, 'user-modal');
}

export async function createUser() {
  clearErr('uf-user-err'); clearErr('uf-pin-err');
  const username = val('uf-user').trim();
  const pin = val('uf-pin');
  const role = val('uf-role');
  if (!username) { setErr('uf-user-err', 'Required'); return; }
  if (!pin || pin.length < 4) { setErr('uf-pin-err', '4-6 digits required'); return; }
  disableBtn('uf-save-btn', true);
  try {
    await apiPost('/users', { username, pin, role });
    closeModal(); switchSettingsTab('users');
  } catch (e: any) { showToast(e.message); } finally { disableBtn('uf-save-btn', false); }
}

export async function updateUser(id: string) {
  clearErr('uf-pin-err');
  const pin = val('uf-pin');
  const role = val('uf-role');
  if (pin && pin.length < 4) { setErr('uf-pin-err', '4-6 digits required'); return; }
  disableBtn('uf-save-btn', true);
  try {
    await apiPut(`/users/${id}`, { pin: pin || undefined, role });
    (window as any).closeModal(); switchSettingsTab('users');
  } catch (e: any) { showToast(e.message); } finally { disableBtn('uf-save-btn', false); }
}

export async function delUser(id: string) {
  const ok = await showConfirmModal(`<h3>Delete User</h3><p style="color:var(--c-text-secondary)">Are you sure?</p>`);
  if (!ok) return;
  try { await apiDel(`/users/${id}`); switchSettingsTab('users'); }
  catch (e: any) { showToast(e.message); }
}

// ─── Audit Log ───
async function loadAuditTab() {
  const db = (window as any).__audit_from_db;
  const logs = await apiGet<any[]>('/audit-log');
  return `
    <h3>Audit Log</h3>
    <div class="table-wrap" style="margin-top:var(--space-4)">
      <table>
        <thead><tr><th>Date</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th><th>Change</th></tr></thead>
        <tbody>
          ${logs.length ? logs.map((l: any) => `
            <tr>
              <td data-label="Date">${fmtDate(l.created_at)}</td>
              <td data-label="User">${esc(l.username || 'System')}</td>
              <td data-label="Action"><span class="status-badge" style="background:${l.action==='delete'?'var(--c-danger-bg)':l.action==='update'?'var(--c-warning-bg)':'var(--c-success-bg)'};color:${l.action==='delete'?'var(--c-danger)':l.action==='update'?'var(--c-warning)':'var(--c-success)'}">${l.action}</span></td>
              <td data-label="Entity">${esc(l.entity)}</td>
              <td data-label="Details" style="font-size:var(--fs-xs);color:var(--c-text-muted)">${esc(l.details || '-')}</td>
              <td data-label="Change" style="font-size:var(--fs-xs);color:var(--c-text-muted)">${l.new_values ? 'Updated values recorded' : '-'}</td>
            </tr>
          `).join('') : '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--c-text-muted)">No audit entries yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}
