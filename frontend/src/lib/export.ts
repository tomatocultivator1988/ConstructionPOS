import { showModal, closeModal, showToast } from './helpers';

export type ExportPeriod = { from: string; to: string; label: string };
type ExportHandler = (period: ExportPeriod, format: 'pdf' | 'csv') => void | Promise<void>;

let pendingHandler: ExportHandler | null = null;

function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function periodFromForm(): ExportPeriod {
  const kind = (document.getElementById('export-period-kind') as HTMLSelectElement)?.value || 'month';
  const anchor = (document.getElementById('export-period-anchor') as HTMLInputElement)?.value || dateValue(new Date());
  const date = new Date(`${anchor}T00:00:00`);
  let from = dateValue(date); let to = from; let label = `Day · ${from}`;
  if (kind === 'month') {
    from = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
    to = dateValue(new Date(date.getFullYear(), date.getMonth() + 1, 0)); label = `Month · ${from.slice(0, 7)}`;
  } else if (kind === 'quarter') {
    const quarter = Math.floor(date.getMonth() / 3); const start = new Date(date.getFullYear(), quarter * 3, 1);
    from = dateValue(start); to = dateValue(new Date(date.getFullYear(), quarter * 3 + 3, 0)); label = `Quarter · Q${quarter + 1} ${date.getFullYear()}`;
  } else if (kind === 'year') {
    from = `${date.getFullYear()}-01-01`; to = `${date.getFullYear()}-12-31`; label = `Year · ${date.getFullYear()}`;
  } else {
    const customFrom = (document.getElementById('export-from') as HTMLInputElement)?.value || from;
    const customTo = (document.getElementById('export-to') as HTMLInputElement)?.value || customFrom;
    from = customFrom; to = customTo; label = `${from} – ${to}`;
  }
  return { from, to, label };
}

export function showExportPeriodModal(title: string, handler: ExportHandler) {
  pendingHandler = handler;
  const today = dateValue(new Date());
  showModal(`<h3>Export ${title}</h3><p class="modal-help">Choose the period and file type. PDF opens a print-ready document; CSV opens cleanly in Excel.</p><div class="form-group"><label for="export-period-kind">Period</label><select id="export-period-kind" onchange="toggleExportCustomRange()"><option value="day">Day</option><option value="month" selected>Month</option><option value="quarter">Quarter</option><option value="year">Year</option><option value="custom">Custom range</option></select></div><div class="form-group"><label for="export-period-anchor">Reference date</label><input id="export-period-anchor" type="date" value="${today}" /></div><div id="export-custom-range" class="form-row" style="display:none"><div class="form-group"><label for="export-from">From</label><input id="export-from" type="date" value="${today}" /></div><div class="form-group"><label for="export-to">To</label><input id="export-to" type="date" value="${today}" /></div></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn" onclick="submitExportPeriod('csv')">Excel / CSV</button><button class="btn btn-primary" onclick="submitExportPeriod('pdf')">PDF / Print</button></div>`, 'export-period-modal');
}

export function toggleExportCustomRange() {
  const custom = document.getElementById('export-custom-range'); const kind = (document.getElementById('export-period-kind') as HTMLSelectElement)?.value;
  if (custom) custom.style.display = kind === 'custom' ? 'flex' : 'none';
}

export async function submitExportPeriod(format: 'pdf' | 'csv') {
  if (!pendingHandler) return;
  const period = periodFromForm();
  if (!period.from || !period.to || period.from > period.to) { showToast('Choose a valid date range'); return; }
  const handler = pendingHandler; pendingHandler = null; closeModal();
  try { await handler(period, format); } catch (e: any) { showToast(e?.message || 'Unable to export data'); }
}

function cell(value: unknown) { return String(value ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)); }

export function exportTable(title: string, period: ExportPeriod, headers: string[], rows: unknown[][], format: 'pdf' | 'csv', summary = '') {
  if (format === 'csv') {
    const csv = [headers, ...rows].map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${period.from}-to-${period.to}.csv`; a.click(); URL.revokeObjectURL(url); return;
  }
  const win = window.open('', '_blank');
  if (!win) { showToast('Allow pop-ups to create the PDF/print preview'); return; }
  win.document.write(`<!doctype html><html><head><title>${cell(title)} · ${cell(period.label)}</title><style>body{font-family:Arial,sans-serif;color:#17202a;margin:28px;font-size:11px}h1{margin:0 0 4px;color:#0b2945}p{color:#475569;margin:4px 0 16px}.summary{font-weight:700;margin:10px 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left}th{background:#e2e8f0;color:#1e293b}td.num{text-align:right}@media print{body{margin:12mm}}</style></head><body><h1>${cell(title)}</h1><p>${cell(period.label)} · ${cell(period.from)} to ${cell(period.to)}</p>${summary ? `<div class="summary">${cell(summary)}</div>` : ''}<table><thead><tr>${headers.map(h => `<th>${cell(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
  win.document.close();
}
