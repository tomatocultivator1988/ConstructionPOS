import { apiGet, apiPut } from '../lib/api';
import { esc, fmtDate, fmtPeso } from '../lib/helpers';

let receivablePage = 1;
const RECEIVABLE_PAGE_SIZE = 15;
let receivableSearch = '';
let receivableStatus = 'all';
let receivablesTrend: any[] = [];

export async function renderReceivables(): Promise<string> {
  const [result, trend] = await Promise.all([
    apiGet<any>(`/invoices/receivables?page=${receivablePage}&pageSize=${RECEIVABLE_PAGE_SIZE}&status=${receivableStatus}&search=${encodeURIComponent(receivableSearch)}`),
    apiGet<any[]>('/invoices/receivables-trend'),
  ]);
  receivablesTrend = trend || [];
  const rows = result.data || [];
  const total = Number(result.total || 0);
  const summary = result.summary || {};
  return `<div class="page-header"><div><div class="page-kicker">Credit sales</div><h2>Receivables</h2><p class="page-subtitle">Track customer balances and credit sales in one place.</p></div></div>
    <div class="dashboard-grid report-metrics report-metrics-4 receivables-summary"><div class="dashboard-card card-danger"><div class="card-label">Total Outstanding</div><div class="card-value">${fmtPeso(summary.outstanding)}</div><div class="card-sub">Open customer balances</div></div><div class="dashboard-card card-warning"><div class="card-label">Open Accounts</div><div class="card-value">${summary.open_accounts || 0}</div><div class="card-sub">Unpaid or partially paid</div></div><div class="dashboard-card card-info"><div class="card-label">Credit Sales</div><div class="card-value">${summary.credit_sales || 0}</div><div class="card-sub">All recorded credit sales</div></div><div class="dashboard-card card-success"><div class="card-label">Paid Credit Sales</div><div class="card-value">${summary.paid_sales || 0}</div><div class="card-sub">History retained</div></div></div>
    <div class="receivables-toolbar dashboard-card"><input id="receivables-search" type="search" value="${esc(receivableSearch)}" placeholder="Search buyer or invoice number" onkeydown="if(event.key==='Enter')filterReceivables()" /><select id="receivables-status" onchange="filterReceivables()"><option value="all" ${receivableStatus === 'all' ? 'selected' : ''}>All credit sales</option><option value="unpaid" ${receivableStatus === 'unpaid' ? 'selected' : ''}>Unpaid</option><option value="partial" ${receivableStatus === 'partial' ? 'selected' : ''}>Partially paid</option><option value="paid" ${receivableStatus === 'paid' ? 'selected' : ''}>Paid</option></select><button class="btn btn-primary" onclick="filterReceivables()">Search</button></div>
    <section class="dashboard-card receivables-trend-card"><div class="section-heading"><div><h3>Current Balance by Month</h3><p class="card-sub">Month-end outstanding credit balance, with credit sales and collections for context.</p></div></div><div class="receivables-trend-wrap"><canvas id="receivables-trend-chart"></canvas></div></section>
    <div class="dashboard-card receivables-card"><div class="section-heading"><div><h3>Customer balance ledger</h3><p class="card-sub">${total} recorded credit sale${total === 1 ? '' : 's'} · highest open balance first</p></div></div><div class="table-wrap"><table><thead><tr><th>Customer / Account</th><th>Invoice</th><th>Sale Date</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th class="actions">Actions</th></tr></thead><tbody>${rows.length ? rows.map((row: any) => { const balance = Number(row.balance || 0); const paid = Number(row.net_paid || 0); const status = balance <= 0.005 ? 'paid' : paid > 0 ? 'partial' : 'pending'; return `<tr><td data-label="Customer"><strong>${esc(row.account_name)}</strong><button class="btn btn-sm receivable-edit-btn" onclick="showReceivableNameModal('${row.id}')">Edit</button></td><td data-label="Invoice">${esc(row.invoice_number)}</td><td data-label="Sale Date">${fmtDate(row.issued_date)}</td><td data-label="Total" class="money">${fmtPeso(row.total)}</td><td data-label="Paid" class="money positive">${fmtPeso(paid)}</td><td data-label="Balance" class="money ${balance > 0 ? 'negative' : 'positive'}">${fmtPeso(Math.max(0, balance))}</td><td data-label="Status"><span class="status-badge ${status}">${status === 'paid' ? 'Paid' : status === 'partial' ? 'Partially paid' : 'Unpaid'}</span></td><td data-label="" class="actions"><button class="btn btn-success btn-sm" onclick="showInvoiceDetail('${row.id}')">${balance > 0.005 ? 'Record Payment' : 'View'}</button></td></tr>`; }).join('') : '<tr><td colspan="8" class="empty-state">No credit sales match this filter.</td></tr>'}</tbody></table></div>${total > RECEIVABLE_PAGE_SIZE ? `<div class="pagination"><span>Showing ${(receivablePage - 1) * RECEIVABLE_PAGE_SIZE + 1}–${Math.min(receivablePage * RECEIVABLE_PAGE_SIZE, total)} of ${total}</span><button class="btn btn-sm" ${receivablePage === 1 ? 'disabled' : ''} onclick="changeReceivablePage(${receivablePage - 1})">Previous</button><strong>Page ${receivablePage} of ${Math.ceil(total / RECEIVABLE_PAGE_SIZE)}</strong><button class="btn btn-sm" ${receivablePage >= Math.ceil(total / RECEIVABLE_PAGE_SIZE) ? 'disabled' : ''} onclick="changeReceivablePage(${receivablePage + 1})">Next</button></div>` : ''}</div>`;
}

export async function showReceivableNameModal(invoiceId: string) {
  const invoice = await apiGet<any>(`/invoices/${invoiceId}`);
  (window as any).showModal?.(`<h3>Edit Customer / Account Name</h3><div class="form-group"><label for="receivable-name-edit">Customer or Account Name *</label><input id="receivable-name-edit" maxlength="120" value="${esc(invoice.credit_account_name || invoice.customer_name || '')}" /></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveReceivableName('${invoiceId}')">Save</button></div>`, 'receivable-name-modal');
}

export async function saveReceivableName(invoiceId: string) { const name = (document.getElementById('receivable-name-edit') as HTMLInputElement)?.value.trim() || ''; if (!name) { (window as any).showToast?.('Customer or account name is required'); return; } try { await apiPut(`/invoices/${invoiceId}/credit-account`, { credit_account_name: name }); (window as any).closeModal?.(); (window as any).showToast?.('Customer name updated', 'success'); (window as any).loadView?.('receivables'); } catch (e: any) { (window as any).showToast?.(e.message); } }

export function filterReceivables() { receivableSearch = (document.getElementById('receivables-search') as HTMLInputElement)?.value.trim() || ''; receivableStatus = (document.getElementById('receivables-status') as HTMLSelectElement)?.value || 'all'; receivablePage = 1; (window as any).loadView('receivables'); }
export function changeReceivablePage(page: number) { receivablePage = Math.max(1, page); (window as any).loadView('receivables'); }

export function drawReceivablesTrend() {
  const canvas = document.getElementById('receivables-trend-chart') as HTMLCanvasElement | null;
  const ChartCtor = (window as any).Chart;
  if (!canvas || !ChartCtor || !receivablesTrend.length) return;
  const chart = (window as any).__receivablesTrendChart;
  if (chart) { try { chart.destroy(); } catch {} }
  const labels = receivablesTrend.map(row => { const [year, month] = row.month.split('-').map(Number); return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); });
  (window as any).__receivablesTrendChart = new ChartCtor(canvas, { type: 'bar', data: { labels, datasets: [
    { label: 'Current Balance', data: receivablesTrend.map(row => row.current_balance), backgroundColor: '#f28c28', borderRadius: 5 },
    { label: 'Credit Sales', data: receivablesTrend.map(row => row.credit_sales), backgroundColor: '#4da3d8', borderRadius: 5 },
    { label: 'Collections', data: receivablesTrend.map(row => row.collections), backgroundColor: '#22c55e', borderRadius: 5 },
  ] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#637d95', callback: (value: any) => '₱' + Number(value).toLocaleString() }, grid: { color: 'rgba(11,41,69,.10)' } }, x: { ticks: { color: '#637d95' }, grid: { display: false } } }, plugins: { legend: { position: 'bottom', labels: { color: '#385671', usePointStyle: true } }, tooltip: { callbacks: { label: (context: any) => ` ${context.dataset.label}: ₱${Number(context.raw || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` } } } } });
}
