import { apiGet, apiPost, apiPut, apiDel } from '../lib/api';
import { esc, val, setErr, clearErr, disableBtn, fmtDate, fmtPeso } from '../lib/helpers';
import { showModal, closeModal, showToast, showConfirmModal } from '../lib/helpers';
import { loadView } from '../lib/router';
import type { Expense } from '../lib/types';
import { showExportPeriodModal, exportTable, type ExportPeriod } from '../lib/export';

let EXPENSE_CATEGORIES = [
  'Rent', 'Utilities', 'Labor/Salary', 'Delivery/Transport',
  'Tools & Equipment', 'Maintenance', 'Supplies', 'Other'
];
const PAYMENT_METHODS = ['cash', 'bank', 'card', 'gcash', 'check', 'credit'];

function catOptions(selected?: string) {
  return EXPENSE_CATEGORIES.map(c => `<option value="${esc(c)}"${c === selected ? ' selected' : ''}>${esc(c)}</option>`).join('');
}

export async function addExpenseCategory() {
  showModal(`<h3>New Expense Category</h3><p class="modal-help">Add a reusable category for expense records and reports.</p><div class="form-group"><label for="expense-category-name">Name *</label><input id="expense-category-name" maxlength="60" autofocus placeholder="Enter category name" /><div class="field-error" id="expense-category-name-err"></div></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveExpenseCategory()">Add</button></div>`, 'expense-category-modal');
}

export async function saveExpenseCategory() {
  const name = val('expense-category-name').trim();
  if (name.length < 2) { setErr('expense-category-name-err', 'Enter at least 2 characters'); return; }
  try {
    const option = await apiPost<{ name: string }>('/catalog', { type: 'expense_category', name });
    if (!EXPENSE_CATEGORIES.includes(option.name)) EXPENSE_CATEGORIES.push(option.name);
    const select = document.getElementById('exf-category') as HTMLSelectElement | null;
    if (select) { const opt = document.createElement('option'); opt.value = option.name; opt.textContent = option.name; opt.selected = true; select.appendChild(opt); }
    closeModal(); showToast('Expense category added', 'success');
  } catch (e: any) { showToast(e.message || 'Unable to add category'); }
}

export async function renderExpenses(): Promise<string> {
  const [expenses, summary, catalog] = await Promise.all([
    apiGet<Expense[]>('/expenses'),
    apiGet<{ category: string; total: number }[]>('/expenses/summary'),
    apiGet<Record<string, string[]>>('/catalog'),
  ]);
  if (catalog.expense_category?.length) EXPENSE_CATEGORIES = catalog.expense_category;
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  return `
    <div class="page-header">
      <h2>Expenses</h2>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap"><button class="btn" onclick="exportExpenses()">Export</button><button class="btn btn-primary" onclick="showExpenseModal()">+ Add Expense</button></div>
    </div>
    <div class="chart-grid" style="margin-bottom:var(--space-4)">
      <div class="dashboard-card card-info">
        <div class="card-label">Total Expenses</div>
        <div class="card-value">${fmtPeso(totalExpenses)}</div>
        <div class="card-sub">${expenses.length} entries</div>
      </div>
      <div class="dashboard-card card-info">
        <div class="card-label">Categories</div>
        <div class="card-sub" style="margin-top:var(--space-2)">
          ${summary.slice(0, 5).map(s => `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:var(--fs-xs)"><span>${esc(s.category)}</span><span style="font-weight:600">${fmtPeso(s.total)}</span></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th>Payment</th><th>Amount</th><th class="actions">Actions</th></tr></thead>
        <tbody>
          ${expenses.length ? expenses.map((e: Expense) => `
            <tr>
              <td data-label="Date">${fmtDate(e.expense_date)}</td>
              <td data-label="Category"><span class="status-badge" style="background:var(--c-primary-bg);color:var(--c-primary)">${esc(e.category)}</span></td>
              <td data-label="Description">${esc(e.description || '-')}</td>
              <td data-label="Vendor">${esc(e.vendor || '-')}</td>
              <td data-label="Payment">${esc(e.payment_method || 'cash')}</td>
              <td data-label="Amount" style="font-weight:600">${fmtPeso(e.amount)}</td>
              <td data-label="" class="actions">
                <button class="btn btn-primary btn-sm" onclick="editExpense('${e.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="delExpense('${e.id}')">Delete</button>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--c-text-muted);padding:2rem">No expenses recorded yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

export function exportExpenses() {
  showExportPeriodModal('Expenses', async (period: ExportPeriod, format) => {
    const [rows, summary] = await Promise.all([
      apiGet<Expense[]>(`/expenses?from=${period.from}&to=${period.to}`),
      apiGet<{ category: string; total: number }[]>(`/expenses/summary?from=${period.from}&to=${period.to}`),
    ]);
    const data = rows.map(e => [fmtDate(e.expense_date), e.category, e.description || '—', e.vendor || '—', e.payment_method || 'cash', fmtPeso(e.amount)]);
    exportTable('Expenses', period, ['Date', 'Category', 'Description', 'Vendor / Payee', 'Payment', 'Amount'], data, format, `Total expenses: ${fmtPeso(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0))} · ${summary.length} categories`);
  });
}

export function showExpenseModal(data?: Expense) {
  const isEdit = !!data;
  return showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Expense</h3>
    <div class="form-row">
      <div class="form-group">
        <label>Category *</label>
        <div class="catalog-field"><select id="exf-category"><option value="">Select category...</option>${catOptions(data?.category)}</select><button type="button" class="btn btn-sm" onclick="addExpenseCategory()">+ Add</button></div>
        <div class="field-error" id="exf-category-err"></div>
      </div>
      <div class="form-group">
        <label>Amount *</label>
        <input id="exf-amount" type="number" step="0.01" min="0.01" value="${data?.amount ?? ''}" placeholder="0.00" />
        <div class="field-error" id="exf-amount-err"></div>
      </div>
    </div>
    <div class="form-group">
      <label>Payment method *</label>
      <select id="exf-payment">${PAYMENT_METHODS.map(m => `<option value="${m}"${(data?.payment_method || 'cash') === m ? ' selected' : ''}>${m[0].toUpperCase()+m.slice(1)}</option>`).join('')}</select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Date *</label>
        <input id="exf-date" type="date" value="${data?.expense_date?.slice(0, 10) ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date())}" />
        <div class="field-error" id="exf-date-err"></div>
      </div>
      <div class="form-group">
        <label>Vendor / Payee</label>
        <input id="exf-vendor" maxlength="100" value="${esc(data?.vendor || '')}" placeholder="e.g. Meralco, PLDT..." />
      </div>
    </div>
    <div class="form-group">
      <label>Description</label>
      <input id="exf-desc" maxlength="200" value="${esc(data?.description || '')}" placeholder="What was this expense for?" />
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="exf-save-btn" onclick="${isEdit ? `updateExpense('${data!.id}')` : 'createExpense()'}">Save</button>
    </div>
  `, 'expense-modal');
}

export async function createExpense() {
  clearErr('exf-category-err'); clearErr('exf-amount-err'); clearErr('exf-date-err');
  const category = val('exf-category');
  const amount = parseFloat(val('exf-amount'));
  const date = val('exf-date');
  const vendor = val('exf-vendor').trim();
  const description = val('exf-desc').trim();
  const payment_method = val('exf-payment');
  if (!category) { setErr('exf-category-err', 'Category is required'); return; }
  if (isNaN(amount) || amount <= 0) { setErr('exf-amount-err', 'Amount must be > 0'); return; }
  if (!date) { setErr('exf-date-err', 'Date is required'); return; }
  disableBtn('exf-save-btn', true);
  try {
    await apiPost('/expenses', { category, amount, expense_date: date, vendor: vendor || null, description: description || null, payment_method });
    closeModal(); loadView('expenses');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('exf-save-btn', false); }
}

export async function updateExpense(id: string) {
  clearErr('exf-category-err'); clearErr('exf-amount-err'); clearErr('exf-date-err');
  const category = val('exf-category');
  const amount = parseFloat(val('exf-amount'));
  const date = val('exf-date');
  const vendor = val('exf-vendor').trim();
  const description = val('exf-desc').trim();
  const payment_method = val('exf-payment');
  if (!category) { setErr('exf-category-err', 'Category is required'); return; }
  if (isNaN(amount) || amount <= 0) { setErr('exf-amount-err', 'Amount must be > 0'); return; }
  if (!date) { setErr('exf-date-err', 'Date is required'); return; }
  disableBtn('exf-save-btn', true);
  try {
    await apiPut(`/expenses/${id}`, { category, amount, expense_date: date, vendor: vendor || null, description: description || null, payment_method });
    closeModal(); loadView('expenses');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('exf-save-btn', false); }
}

export async function editExpense(id: string) {
  const expenses = await apiGet<Expense[]>('/expenses');
  showExpenseModal(expenses.find((e: Expense) => e.id === id));
}

export async function delExpense(id: string) {
  const ok = await showConfirmModal(`<h3>Delete Expense</h3><p style="color:var(--c-text-secondary)">Are you sure you want to delete this expense record?</p>`);
  if (!ok) return;
  try { await apiDel(`/expenses/${id}`); loadView('expenses'); }
  catch (e: any) { showToast(e.message); }
}
