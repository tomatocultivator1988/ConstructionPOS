import { apiGet } from '../lib/api';
import { esc, fmtDate, fmtPeso, businessDate, businessMonth } from '../lib/helpers';
import { showToast } from '../lib/helpers';
import { showExportPeriodModal, exportTable, type ExportPeriod } from '../lib/export';

let currentSubTab = 'daily';
let currentReportPeriod = 'month';
let monthlyReportData: any = null;
let pnlChart: any = null;

function reportPeriodRange(period = currentReportPeriod): { from: string; to: string } {
  const today = businessDate();
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (period === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (period === 'week') {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    const monday = new Date(date); monday.setUTCDate(date.getUTCDate() - mondayOffset);
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
  }
  if (period === 'quarter') {
    const quarter = Math.floor((month - 1) / 3); const start = new Date(Date.UTC(year, quarter * 3, 1)); const end = new Date(Date.UTC(year, quarter * 3 + 3, 0));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}

function periodText() {
  const range = reportPeriodRange();
  return `${fmtDate(range.from)} – ${fmtDate(range.to)}`;
}

function reportPeriodControl() {
  if (currentSubTab === 'daily') {
    return `<div class="report-period-bar daily-period-bar"><div><strong>Daily sales date</strong><span>Choose the day to review</span></div><input id="rpt-daily-date" type="date" value="${reportPeriodRange().to}" onchange="reloadDaily()" /></div>`;
  }
  return `<div class="report-period-bar"><div><strong>Report period</strong><span id="report-period-range">${periodText()}</span></div><select id="report-period" onchange="applyReportPeriod(this.value)"><option value="week" ${currentReportPeriod === 'week' ? 'selected' : ''}>This week</option><option value="month" ${currentReportPeriod === 'month' ? 'selected' : ''}>This month</option><option value="quarter" ${currentReportPeriod === 'quarter' ? 'selected' : ''}>This quarter</option><option value="year" ${currentReportPeriod === 'year' ? 'selected' : ''}>This year</option></select></div>`;
}

export async function renderReports(): Promise<string> {
  return `
    <div class="page-header">
      <h2>Reports</h2>
      <button class="btn" onclick="exportReports()">Export Report</button>
    </div>
    <div id="report-period-control">${reportPeriodControl()}</div>
    <div class="report-tabs" role="tablist" aria-label="Report types">
      <button class="nav-btn ${currentSubTab === 'daily' ? 'active' : ''}" onclick="switchReportTab('daily')" style="font-size:var(--fs-sm)">Daily Sales</button>
      <button class="nav-btn ${currentSubTab === 'monthly' ? 'active' : ''}" onclick="switchReportTab('monthly')" style="font-size:var(--fs-sm)">P&L</button>
      <button class="nav-btn ${currentSubTab === 'books' ? 'active' : ''}" onclick="switchReportTab('books')" style="font-size:var(--fs-sm)">Books</button>
    </div>
    <div id="report-content">
      ${await loadDailyReport()}
    </div>
  `;
}

export async function switchReportTab(tab: string) {
  currentSubTab = tab;
  const periodControl = document.getElementById('report-period-control');
  if (periodControl) periodControl.innerHTML = reportPeriodControl();
  const el = document.getElementById('report-content');
  if (!el) return;
  el.innerHTML = `<div class="loading-skeleton">${'<div class="sk-item"></div>'.repeat(4)}</div>`;
  try {
    if (tab === 'daily') el.innerHTML = await loadDailyReport();
    else if (tab === 'monthly') { el.innerHTML = await loadMonthlyReport(); drawPnlChart(); }
    else if (tab === 'tax') el.innerHTML = await loadTaxReport();
    else if (tab === 'range') el.innerHTML = await loadRangeForm();
    else if (tab === 'books') el.innerHTML = await loadBooksReport();
    else if (tab === 'summary') el.innerHTML = await loadFinancialSummary();
    document.querySelectorAll('.report-tabs .nav-btn').forEach(b => b.classList.remove('active'));
  } catch (e: any) { showToast(e.message); }
}

export function applyReportPeriod(period: string) {
  if (!['week', 'month', 'quarter', 'year'].includes(period)) return;
  currentReportPeriod = period;
  (window as any).loadView?.('reports');
}

export function exportReports() {
  showExportPeriodModal('Reports', async (period: ExportPeriod, format) => {
    if (currentSubTab === 'monthly') {
      const data = await apiGet<any>(`/reports/range?type=profit&from=${period.from}&to=${period.to}`);
      exportTable('Profit and Loss Report', period, ['Metric', 'Amount'], [['Revenue', fmtPeso(data.revenue)], ['COGS', fmtPeso(data.cogs)], ['Gross Profit', fmtPeso(data.gross_profit)], ['Expenses', fmtPeso(data.expenses)], ['Net Profit', fmtPeso(data.net_profit)]], format, `Period: ${period.label}`);
      return;
    }
    const data = await apiGet<any>(`/reports/range?type=sales&from=${period.from}&to=${period.to}`);
    const rows = (data.invoices || []).map((row: any) => [row.invoice_number, row.customer_name, fmtDate(row.issued_date), row.status, fmtPeso(row.total), fmtPeso(row.paid)]);
    exportTable('Sales Report', period, ['Invoice', 'Buyer', 'Issued', 'Status', 'Total', 'Paid'], rows, format, `Gross sales: ${fmtPeso(data.totals?.gross_sales || 0)} · Profit: ${fmtPeso(data.totals?.profit || 0)} · ${rows.length} invoice${rows.length === 1 ? '' : 's'}`);
  });
}

async function loadFinancialSummary(from?: string, to?: string) {
  const start = from || businessDate(); const end = to || start;
  const data = await apiGet<any>(`/reports/financial-summary?from=${start}&to=${end}`);
  const profitColor = data.net_profit >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
  return `<div class="report-filters"><label>From</label><input id="rpt-summary-from" type="date" value="${start}" /><label>To</label><input id="rpt-summary-to" type="date" value="${end}" /><button class="btn btn-primary btn-sm" onclick="reloadFinancialSummary()">Load</button></div>
    <div class="dashboard-grid report-metrics report-metrics-4">
      <div class="dashboard-card card-success"><div class="card-label">Net Sales</div><div class="card-value">${fmtPeso(data.net_sales)}</div><div class="card-sub">Accrual basis</div></div>
      <div class="dashboard-card card-warning"><div class="card-label">COGS</div><div class="card-value">${fmtPeso(data.cogs)}</div></div>
      <div class="dashboard-card card-success"><div class="card-label">Gross Profit</div><div class="card-value">${fmtPeso(data.gross_profit)}</div></div>
      <div class="dashboard-card card-danger"><div class="card-label">Operating Expenses</div><div class="card-value">${fmtPeso(data.expenses)}</div></div>
    </div>
    <div class="chart-card" style="margin-top:var(--space-4);background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-lg);padding:var(--space-5)">
      <div class="chart-title">Financial Reconciliation</div>
      <div class="summary-line"><span>Tax payable</span><b>${fmtPeso(data.tax_payable)}</b></div>
      <div class="summary-line"><span>Collections (payments less refunds)</span><b>${fmtPeso(data.collections - data.refunds)}</b></div>
      <div class="summary-line"><span>Accounts receivable</span><b>${fmtPeso(data.accounts_receivable)}</b></div>
      <div class="summary-line total"><span>Net Profit</span><b style="color:${profitColor}">${fmtPeso(data.net_profit)}</b></div>
    </div>`;
}

export async function reloadFinancialSummary() {
  const from = (document.getElementById('rpt-summary-from') as HTMLInputElement)?.value;
  const to = (document.getElementById('rpt-summary-to') as HTMLInputElement)?.value;
  const el = document.getElementById('report-content'); if (el) el.innerHTML = await loadFinancialSummary(from, to);
}

async function loadBooksReport(from?: string, to?: string) {
  const period = reportPeriodRange();
  const start = from || period.from; const end = to || period.to;
  const [data, cash] = await Promise.all([apiGet<any>(`/reports/books?from=${start}&to=${end}`), apiGet<any>(`/reports/cash-flow?from=${start}&to=${end}`)]);
  const rows = (items: any[], fields: string[]) => items.length ? items.map((r: any) => `<tr>${fields.map(f => `<td data-label="${esc(f)}">${esc(String(r[f] ?? ''))}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="6">No entries</td></tr>';
  return `<div class="report-filters"><label>From</label><input id="rpt-books-from" type="date" value="${start}" /><label>To</label><input id="rpt-books-to" type="date" value="${end}" /><button class="btn btn-primary btn-sm" onclick="reloadBooks()">Load</button><button class="btn btn-primary btn-sm" onclick="printReport('books','${start} to ${end}')">Export</button></div>
    <h3>Sales Journal</h3><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date</th><th>Buyer</th><th>Net Sales</th><th>Tax</th><th>Adjusted Total</th></tr></thead><tbody>${rows(data.sales,['invoice_number','issued_date','buyer','net_sales','adjusted_tax','adjusted_total'])}</tbody></table></div>
    <h3>Cash Receipts Journal</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Invoice</th><th>Method</th><th>Amount</th></tr></thead><tbody>${rows(data.receipts,['payment_date','invoice_number','method','amount'])}</tbody></table></div>
    <h3>Expenses / Purchases</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th>Payment</th><th>Description</th><th>Amount</th></tr></thead><tbody>${rows(data.expenses,['expense_date','category','vendor','payment_method','description','amount'])}</tbody></table></div>
    <h3>Accounts Receivable</h3><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Buyer</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${rows(data.receivables,['invoice_number','buyer','total','paid','balance'])}</tbody></table></div>
    <h3>Cash Flow Summary</h3><div class="summary-line"><span>Cash receipts</span><b>${fmtPeso(cash.cash_receipts)}</b></div><div class="summary-line"><span>Cash refunds</span><b>${fmtPeso(cash.cash_refunds)}</b></div><div class="summary-line"><span>Cash expenses</span><b>${fmtPeso(cash.cash_expenses)}</b></div><div class="summary-line total"><span>Net cash change</span><b>${fmtPeso(cash.net_cash_change)}</b></div>`;
}

export async function reloadBooks() {
  const from = (document.getElementById('rpt-books-from') as HTMLInputElement)?.value;
  const to = (document.getElementById('rpt-books-to') as HTMLInputElement)?.value;
  const el = document.getElementById('report-content'); if (el) el.innerHTML = await loadBooksReport(from, to);
}

async function loadDailyReport(date?: string) {
  const d = date || reportPeriodRange().to;
  const data = await apiGet<any>(`/reports/daily?date=${d}`);
  return `
    <div class="report-filters">
      <button class="btn btn-primary btn-sm" onclick="printReport('daily', '${d}')">Export</button>
    </div>
    <div class="dashboard-grid report-metrics report-metrics-4">
      <div class="dashboard-card card-success"><div class="card-label">Gross Sales</div><div class="card-value">${fmtPeso(data.totals.gross_sales)}</div></div>
      <div class="dashboard-card card-success"><div class="card-label">Profit</div><div class="card-value">${fmtPeso(data.totals.profit)}</div></div>
      <div class="dashboard-card card-info"><div class="card-label">Tax Collected</div><div class="card-value">${fmtPeso(data.totals.tax_collected)}</div></div>
      <div class="dashboard-card card-info"><div class="card-label">Invoices</div><div class="card-value" style="font-size:var(--fs-2xl)">${data.totals.invoice_count}</div></div>
    </div>
    ${data.paymentMethods?.length ? `
    <div class="report-payment-methods">
      <span style="font-weight:600;color:var(--c-text-muted);font-size:var(--fs-xs)">PAYMENT METHODS:</span>
      ${data.paymentMethods.map((m: any) => `<span style="font-size:var(--fs-sm)"><strong>${esc(m.method)}</strong> ${fmtPeso(m.total)}</span>`).join(' | ')}
    </div>` : ''}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Invoice #</th><th>Customer</th><th>Total</th><th>Status</th><th>Paid</th></tr></thead>
        <tbody>
          ${data.invoices.length ? data.invoices.map((inv: any) => `
            <tr>
              <td data-label="Invoice #" style="font-weight:600">${esc(inv.invoice_number)}</td>
              <td data-label="Customer">${esc(inv.customer_name)}</td>
              <td data-label="Total" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(inv.total)}</td>
              <td data-label="Status"><span class="status-badge ${inv.status}">${inv.status}</span></td>
              <td data-label="Paid" style="font-family:var(--ff-mono);font-weight:600;color:var(--c-success)">${fmtPeso(inv.paid)}</td>
            </tr>
          `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--c-text-muted);padding:2rem">No transactions for this date</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function loadMonthlyReport(month?: string) {
  const m = month || reportPeriodRange().to.slice(0, 7) || businessMonth();
  const monthStart = `${m}-01`;
  const monthEnd = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const [data, cash, financial] = await Promise.all([
    apiGet<any>(`/reports/monthly?month=${m}`),
    apiGet<any>(`/reports/cash-flow?from=${monthStart}&to=${monthEnd}`),
    apiGet<any>(`/reports/financial-summary?from=${monthStart}&to=${monthEnd}`),
  ]);
  monthlyReportData = data;
  const netColor = data.net_profit >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
  const momColor = data.mom_change >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
  return `
    <div class="report-filters">
      <input type="month" id="rpt-month" value="${m}" onchange="reloadMonthly()" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <button class="btn btn-primary btn-sm" onclick="printReport('monthly', '${m}')">Export</button>
    </div>
    <div class="dashboard-grid report-metrics report-metrics-5">
      <div class="dashboard-card card-success"><div class="card-label">Net Sales</div><div class="card-value">${fmtPeso(data.revenue)}</div><div class="card-sub">Accrual basis</div></div>
      <div class="dashboard-card card-warning"><div class="card-label">COGS</div><div class="card-value">${fmtPeso(data.cogs)}</div></div>
      <div class="dashboard-card card-success"><div class="card-label">Gross Profit</div><div class="card-value">${fmtPeso(data.gross_profit)}</div></div>
      <div class="dashboard-card card-danger"><div class="card-label">Expenses</div><div class="card-value">${fmtPeso(data.expenses)}</div></div>
      <div class="dashboard-card card-info"><div class="card-label">Net Profit</div><div class="card-value" style="color:${netColor}">${fmtPeso(data.net_profit)}</div><div class="card-sub">${data.mom_change >= 0 ? '↑' : '↓'} ${Math.abs(data.mom_change).toFixed(1)}% vs last month</div></div>
    </div>
    <div class="pnl-cash-snapshot"><div class="pnl-cash-heading"><strong>Cash Flow &amp; Credit Snapshot</strong><span>${fmtDate(monthStart)} – ${fmtDate(monthEnd)}</span></div><div class="pnl-cash-grid"><div><span>Cash Collections</span><b>${fmtPeso(cash.cash_receipts)}</b></div><div><span>Cash Refunds</span><b class="negative">${fmtPeso(cash.cash_refunds)}</b></div><div><span>Cash Expenses</span><b class="negative">${fmtPeso(cash.cash_expenses)}</b></div><div><span>Net Cash Change</span><b class="${cash.net_cash_change >= 0 ? 'positive' : 'negative'}">${fmtPeso(cash.net_cash_change)}</b></div><div><span>Credit / Receivables</span><b class="warning-value">${fmtPeso(financial.accounts_receivable)}</b></div></div></div>
    <div class="chart-card pnl-chart-card"><div class="chart-title">P&amp;L Breakdown</div><p class="card-sub">How the selected month’s sales are allocated to costs, expenses, and profit.</p><div class="pnl-chart-wrap"><canvas id="pnl-report-chart"></canvas></div></div>
    <div class="chart-card" style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-lg);padding:var(--space-5)">
      <div class="chart-title">Summary</div>
      <div class="summary-line"><span>Net Sales (accrual)</span><span>${fmtPeso(data.revenue)}</span></div>
      <div class="summary-line"><span>Cost of Goods Sold</span><span>${fmtPeso(data.cogs)}</span></div>
      <div class="summary-line"><span>Gross Profit</span><span style="color:var(--c-success)">${fmtPeso(data.gross_profit)}</span></div>
      <div class="summary-line"><span>Operating Expenses</span><span style="color:var(--c-danger)">${fmtPeso(data.expenses)}</span></div>
      <div class="summary-line total"><span>Net Profit</span><span style="color:${netColor}">${fmtPeso(data.net_profit)}</span></div>
    </div>
  `;
}

async function loadTaxReport(month?: string) {
  const m = month || businessMonth();
  const data = await apiGet<any>(`/reports/tax?month=${m}`);
  return `
    <div class="report-filters">
      <input type="month" id="rpt-tax-month" value="${m}" onchange="reloadTax()" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <button class="btn btn-primary btn-sm" onclick="printReport('tax', '${m}')">Export</button>
    </div>
    <div class="dashboard-grid report-metrics report-metrics-4">
      <div class="dashboard-card card-info"><div class="card-label">Total Invoices</div><div class="card-value">${data.invoice_count}</div></div>
      <div class="dashboard-card card-success"><div class="card-label">VATable Sales</div><div class="card-value">${fmtPeso(data.vatable_sales)}</div></div>
      <div class="dashboard-card card-warning"><div class="card-label">VAT Collected</div><div class="card-value">${fmtPeso(data.vat_collected)}</div></div>
      <div class="dashboard-card card-info"><div class="card-label">Exempt Sales</div><div class="card-value">${fmtPeso(data.exempt_sales)}</div></div>
    </div>
    <div class="chart-card" style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-lg);padding:var(--space-5)">
      <div class="chart-title">Tax Rate Breakdown</div>
      <table style="margin-top:var(--space-2)">
        <thead><tr><th>Tax Rate</th><th>Count</th><th>Taxable Amount</th><th>Tax</th></tr></thead>
        <tbody>
          ${data.by_rate?.length ? data.by_rate.map((r: any) => `
            <tr>
              <td data-label="Tax Rate" style="font-weight:600">${(r.tax_rate * 100).toFixed(0)}%</td>
              <td data-label="Count">${r.count}</td>
              <td data-label="Taxable Amount" style="font-family:var(--ff-mono)">${fmtPeso(r.subtotal)}</td>
              <td data-label="Tax" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(r.tax)}</td>
            </tr>
          `).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--c-text-muted);padding:2rem">No data</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function loadRangeForm() {
  const from = businessDate();
  const to = businessDate();
  return `
    <div class="report-filters">
      <label style="font-size:var(--fs-sm);color:var(--c-text-secondary)">From</label>
      <input type="date" id="rpt-from" value="${from}" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <label style="font-size:var(--fs-sm);color:var(--c-text-secondary)">To</label>
      <input type="date" id="rpt-to" value="${to}" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)" />
      <select id="rpt-type" style="min-height:36px;background:var(--c-surface-elevated);color:var(--c-text);border:1px solid var(--c-border);border-radius:var(--radius-md);padding:0 var(--space-3);font-size:var(--fs-sm)">
        <option value="sales">Sales</option>
        <option value="profit">Profit</option>
      </select>
      <button class="btn btn-primary" onclick="loadRangeReport()">Generate</button>
    </div>
    <div id="range-result"><p style="color:var(--c-text-muted);text-align:center;padding:2rem">Select a date range and click Generate</p></div>
  `;
}

export async function loadRangeReport() {
  const from = (document.getElementById('rpt-from') as HTMLInputElement)?.value || '';
  const to = (document.getElementById('rpt-to') as HTMLInputElement)?.value || '';
  const type = (document.getElementById('rpt-type') as HTMLSelectElement)?.value || 'sales';
  if (!from || !to) { showToast('Select both dates'); return; }

  const data = await apiGet<any>(`/reports/range?from=${from}&to=${to}&type=${type}`);
  const el = document.getElementById('range-result');
  if (!el) return;

  if (type === 'sales') {
    el.innerHTML = `
      <div class="dashboard-grid report-metrics report-metrics-4" style="margin-bottom:var(--space-4)">
        <div class="dashboard-card card-success"><div class="card-label">Gross Sales</div><div class="card-value">${fmtPeso(data.totals.gross_sales)}</div></div>
        <div class="dashboard-card card-success"><div class="card-label">Profit</div><div class="card-value">${fmtPeso(data.totals.profit)}</div></div>
        <div class="dashboard-card card-info"><div class="card-label">Tax Collected</div><div class="card-value">${fmtPeso(data.totals.tax_collected)}</div></div>
        <div class="dashboard-card card-info"><div class="card-label">Invoices</div><div class="card-value" style="font-size:var(--fs-2xl)">${data.totals.invoice_count}</div></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Invoice #</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            ${data.invoices?.length ? data.invoices.map((inv: any) => `
              <tr>
              <td data-label="Invoice #" style="font-weight:600">${esc(inv.invoice_number)}</td>
              <td data-label="Customer">${esc(inv.customer_name)}</td>
              <td data-label="Total" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(inv.total)}</td>
              <td data-label="Status"><span class="status-badge ${inv.status}">${inv.status}</span></td>
              <td data-label="Date">${fmtDate(inv.issued_date)}</td>
              </tr>
            `).join('') : '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--c-text-muted)">No data for this range</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } else {
    const netColor = data.net_profit >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
    el.innerHTML = `
      <div class="dashboard-grid report-metrics report-metrics-4" style="margin-bottom:var(--space-4)">
        <div class="dashboard-card card-success"><div class="card-label">Revenue</div><div class="card-value">${fmtPeso(data.revenue)}</div></div>
        <div class="dashboard-card card-warning"><div class="card-label">COGS</div><div class="card-value">${fmtPeso(data.cogs)}</div></div>
        <div class="dashboard-card card-success"><div class="card-label">Gross Profit</div><div class="card-value">${fmtPeso(data.gross_profit)}</div></div>
        <div class="dashboard-card card-info"><div class="card-label">Net Profit</div><div class="card-value" style="color:${netColor}">${fmtPeso(data.net_profit)}</div></div>
      </div>
    `;
  }
}

export async function reloadDaily() {
  const d = (document.getElementById('rpt-daily-date') as HTMLInputElement)?.value;
  const el = document.getElementById('report-content');
  if (!el) return;
  el.innerHTML = await loadDailyReport(d);
}

export async function reloadMonthly() {
  const m = (document.getElementById('rpt-month') as HTMLInputElement)?.value;
  const el = document.getElementById('report-content');
  if (!el) return;
  el.innerHTML = await loadMonthlyReport(m);
  drawPnlChart();
}

function drawPnlChart() {
  const canvas = document.getElementById('pnl-report-chart') as HTMLCanvasElement | null;
  const ChartCtor = (window as any).Chart;
  if (!canvas || !ChartCtor || !monthlyReportData) return;
  if (pnlChart) { try { pnlChart.destroy(); } catch {} }
  const d = monthlyReportData;
  const netValue = Math.abs(Number(d.net_profit || 0));
  const labels = ['COGS', 'Operating Expenses', d.net_profit >= 0 ? 'Net Profit' : 'Net Loss'];
  const values = [Number(d.cogs || 0), Number(d.expenses || 0), netValue];
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return;
  const colors = ['#637d95', '#ef654a', d.net_profit >= 0 ? '#22c55e' : '#ef4444'];
  pnlChart = new ChartCtor(canvas, {
    type: 'pie',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: '#ffffff', borderWidth: 3, hoverOffset: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#385671', usePointStyle: true, padding: 14, generateLabels: (chart: any) => chart.data.labels.map((label: string, index: number) => ({ text: `${label} · ${((Number(chart.data.datasets[0].data[index]) / total) * 100).toFixed(1)}%`, fillStyle: colors[index], strokeStyle: colors[index], index })) } }, tooltip: { callbacks: { label: (context: any) => ` ${context.label}: ₱${Number(context.raw || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${((Number(context.raw || 0) / total) * 100).toFixed(1)}%)` } } } }
  });
}

export async function reloadTax() {
  const m = (document.getElementById('rpt-tax-month') as HTMLInputElement)?.value;
  const el = document.getElementById('report-content');
  if (!el) return;
  el.innerHTML = await loadTaxReport(m);
}

export function printReport(type: string, date: string) {
  const w = window.open('', '_blank', 'width=800,height=700');
  if (!w) return;
  const content = document.getElementById('report-content')?.innerHTML || '';
  w.document.write(`
    <html><head><title>Jeg Enterprises Report — ${date}</title>
    <style>
      @page { size: A4; margin: 16mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; color: #17202a; background: #fff; margin: 0; font-size: 10pt; }
      body:before { content: 'BUILDPRO CONSTRUCTION SUPPLY'; display: block; font-size: 18pt; font-weight: 800; letter-spacing: .03em; margin-bottom: 3px; }
      body:after { content: 'Generated ${date}'; display: block; margin-top: 18px; padding-top: 8px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 8pt; }
      #report-content, .report-content { display: block !important; }
      h2 { font-size: 15pt; margin: 0 0 14px; }
      h3, h4 { color: #334155; margin: 14px 0 7px; }
      .dashboard-grid { display: grid !important; grid-template-columns: repeat(4, 1fr) !important; gap: 8px !important; margin: 0 0 14px !important; }
      .dashboard-card, .chart-card { background: #fff !important; border: 1px solid #cbd5e1 !important; border-radius: 4px !important; padding: 9px !important; box-shadow: none !important; }
      .card-label { color: #64748b !important; font-size: 8pt !important; text-transform: uppercase; }
      .card-value { color: #0f172a !important; font-size: 13pt !important; }
      .card-sub, .tc-name, .tc-amount { color: #475569 !important; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
      th { background: #e2e8f0; color: #1e293b; font-weight: 700; text-align: left; }
      th, td { border: 1px solid #cbd5e1; padding: 6px 7px; font-size: 8.5pt; }
      .status-badge { border: 0 !important; background: transparent !important; color: #334155 !important; padding: 0 !important; }
      input, select, button, .nav-btn, .no-print { display: none !important; }
      .table-wrap { overflow: visible !important; }
      .summary-line { display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding: 6px 0; }
      .summary-line.total { font-weight: 800; border-top: 2px solid #334155; border-bottom: 0; }
    </style></head><body><div id="report-content">${content}</div>
    <script>window.onload=function(){window.print()}</script>
    </body></html>
  `);
  w.document.close();
}
