import { apiGet } from '../lib/api';
import { esc, fmtDate, fmtPeso } from '../lib/helpers';
import { loadView } from '../lib/router';
import { printReceipt, showReceiptPreview } from './receipt';
import { recordRefund } from './invoices';

let page = 1;
const PAGE_SIZE = 15;
let search = '';

export async function renderReceipts(): Promise<string> {
  const q = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) q.set('search', search);
  const result = await apiGet<any>(`/payments/receipts?${q}`);
  const rows = result.data || [];
  return `<div class="page-header"><h2>Receipts</h2><div style="display:flex;gap:8px;align-items:center"><input id="receipt-search" type="search" placeholder="Search receipt or customer..." value="${esc(search)}" onkeydown="if(event.key==='Enter')filterReceipts()" /><button class="btn btn-primary" onclick="filterReceipts()">Search</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Receipt</th><th>Customer</th><th>Date</th><th>Method</th><th>Amount</th><th class="actions">Actions</th></tr></thead><tbody>
    ${rows.length ? rows.map((r: any) => { const refundable = Math.max(0, Number(r.refundable_amount || 0)); return `<tr><td data-label="Receipt" style="font-weight:600">${esc(r.invoice_number)}</td><td data-label="Customer">${esc(r.customer_name)}</td><td data-label="Date">${fmtDate(r.payment_date)}</td><td data-label="Method">${esc(r.method)}</td><td data-label="Amount" style="font-weight:600">${fmtPeso(r.amount)}</td><td data-label="" class="actions"><button class="btn btn-primary btn-sm" onclick="viewReceipt('${r.invoice_id}')">View</button><button class="btn btn-sm" onclick="printReceipt('${r.invoice_id}')">Print</button>${refundable > 0 ? `<button class="btn btn-warning btn-sm" onclick="recordRefund('${r.invoice_id}', ${refundable}, 'receipts')">Refund</button>` : ''}</td></tr>`; }).join('') : '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--c-text-muted)">No receipts found</td></tr>'}
    </tbody></table></div>
    ${result.total > PAGE_SIZE ? `<div class="pagination"><span>Showing ${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,result.total)} of ${result.total}</span><button class="btn btn-sm" ${page===1?'disabled':''} onclick="changeReceiptPage(${page-1})">Previous</button><strong>Page ${page} of ${result.totalPages}</strong><button class="btn btn-sm" ${page>=result.totalPages?'disabled':''} onclick="changeReceiptPage(${page+1})">Next</button></div>` : ''}`;
}

export function filterReceipts() { search = (document.getElementById('receipt-search') as HTMLInputElement)?.value.trim() || ''; page = 1; loadView('receipts'); }
export function changeReceiptPage(next: number) { page = Math.max(1, next); loadView('receipts'); }
export async function viewReceipt(id: string) { showReceiptPreview(id); }
