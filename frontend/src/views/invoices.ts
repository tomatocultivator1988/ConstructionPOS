import { apiGet, apiPost, apiPut, apiDel } from '../lib/api';
import { esc, val, fmtDate, fmtPeso, setErr, clearErr, disableBtn, isAdmin } from '../lib/helpers';
import { showModal, closeModal, showToast, showConfirmModal } from '../lib/helpers';
import { loadView } from '../lib/router';
import { showReceiptPreview } from './receipt';
import type { Invoice, Material } from '../lib/types';
import { showExportPeriodModal, exportTable, type ExportPeriod } from '../lib/export';

let invoicePage = 1;
const INVOICE_PAGE_SIZE = 15;
let posSearch = '';
let posCategory = '';
let posCart: Array<{ material: Material; quantity: number }> = [];
let posCameraStream: MediaStream | null = null;
let posCameraFrame = 0;

function getPOSCurrentTotal() {
  const subtotal = posCart.reduce((sum, item) => sum + item.quantity * Number(item.material.price_per_unit), 0);
  const taxRate = Number((window as any).__invDefaultTax || 0);
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  return Math.round((subtotal + tax) * 100) / 100;
}

export function enhancePOS() {
  const search = document.getElementById('pos-search') as HTMLInputElement | null;
  if (search) {
    search.placeholder = 'Scan barcode or search product...';
    search.onkeydown = (event) => { if (event.key === 'Enter') scanPOSBarcode(event); };
  }
  document.querySelector('.pos-walkin-label')?.remove();
  document.querySelector('.pos-delivery-note')?.remove();
  document.querySelectorAll('.pos-history th:nth-child(6), .pos-history td:nth-child(6)').forEach((cell) => cell.remove());
  document.querySelector('.pos-history tbody td[colspan="7"]')?.setAttribute('colspan', '6');
  document.querySelectorAll('.pos-cart-item').forEach((row, index) => {
    const item = posCart[index]; const qty = row.querySelector('.pos-qty');
    if (item && qty && !qty.querySelector('input')) qty.innerHTML = `<input class="pos-qty-input" type="number" min="0.01" max="${Number(item.material.stock)}" step="0.01" value="${item.quantity}" aria-label="Quantity" onchange="setPOSQty('${item.material.id}', this.value)" />`;
  });
}

export async function startPOSCameraScan() { return startBarcodeCameraScan(scanPOSCode); }

export async function startBarcodeCameraScan(onDetected: (code: string) => void) {
  const BarcodeDetectorApi = (window as any).BarcodeDetector;
  if (!BarcodeDetectorApi) {
    showToast('Camera barcode scanning is not supported in this browser. Use Chrome or Edge on Android, or use a physical scanner.');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) { showToast('Camera access is not available in this browser'); return; }
  stopPOSCameraScan();
  document.getElementById('pos-camera-modal')?.remove();
  const modal = document.createElement('div'); modal.className = 'modal'; modal.id = 'pos-camera-modal';
  modal.innerHTML = '<div class="modal-content"><h3>Scan Product Barcode</h3><p class="modal-help">Point your camera at a product barcode. The product must already have the barcode saved.</p><div class="pos-camera-wrap"><video id="pos-camera-video" autoplay muted playsinline></video><div class="pos-camera-guide"></div></div><p id="pos-camera-status" class="modal-help">Starting camera…</p><div class="modal-actions"><button class="btn" id="pos-camera-cancel">Cancel</button></div></div>';
  modal.addEventListener('click', event => { if (event.target === modal) { stopPOSCameraScan(); modal.remove(); } });
  document.body.appendChild(modal);
  document.getElementById('pos-camera-cancel')?.addEventListener('click', () => { stopPOSCameraScan(); modal.remove(); });
  try {
    posCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const video = document.getElementById('pos-camera-video') as HTMLVideoElement | null;
    if (!video) { stopPOSCameraScan(); return; }
    video.srcObject = posCameraStream;
    await video.play();
    const detector = new BarcodeDetectorApi({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar', 'qr_code'] });
    const scan = async () => {
      if (!posCameraStream || !document.getElementById('pos-camera-video')) return;
      try {
        const codes = await detector.detect(video);
        const code = codes?.[0]?.rawValue?.trim();
        if (code) { stopPOSCameraScan(); modal.remove(); onDetected(code); return; }
      } catch { /* Keep scanning while the camera has no readable frame. */ }
      posCameraFrame = requestAnimationFrame(scan);
    };
    const status = document.getElementById('pos-camera-status'); if (status) status.textContent = 'Looking for a barcode…';
    posCameraFrame = requestAnimationFrame(scan);
  } catch (e: any) {
    stopPOSCameraScan(); modal.remove();
    showToast(e?.name === 'NotAllowedError' ? 'Camera permission was denied' : 'Unable to open the camera');
  }
}

export function stopPOSCameraScan() {
  if (posCameraFrame) cancelAnimationFrame(posCameraFrame);
  posCameraFrame = 0;
  posCameraStream?.getTracks().forEach(track => track.stop());
  posCameraStream = null;
}

function scanPOSCode(code: string) {
  const normalized = code.trim().toLowerCase();
  const material = ((window as any).__invMaterials || []).find((m: Material) => String(m.barcode || '').trim().toLowerCase() === normalized);
  if (material) addPOSItem(material.id);
  else showToast(`Barcode ${code} is not registered to a product`);
}

export function scanPOSBarcode(event: KeyboardEvent) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const input = event.currentTarget as HTMLInputElement;
  const code = input.value.trim().toLowerCase();
  const material = ((window as any).__invMaterials || []).find((m: Material) => String(m.barcode || '').trim().toLowerCase() === code);
  if (material) { input.value = ''; addPOSItem(material.id); }
  else if (code) showToast('No product found for that barcode');
}

export function setPOSQty(id: string, value: string) {
  const item = posCart.find(entry => entry.material.id === id); const quantity = Number(value);
  if (!item || !Number.isFinite(quantity) || quantity <= 0) { showToast('Quantity must be greater than zero'); return; }
  if (quantity > Number(item.material.stock)) { showToast(`Only ${item.material.stock} ${item.material.unit} available`); return; }
  item.quantity = quantity; loadView('invoices');
}

export async function renderInvoices(): Promise<string> {
  const [invoices, materials, settings] = await Promise.all([
    apiGet<Invoice[] | { data: Invoice[]; total: number }>(`/invoices?page=${invoicePage}&pageSize=${INVOICE_PAGE_SIZE}`),
    apiGet<Material[]>('/materials'),
    apiGet<{ value: string }>('/settings/default_tax_rate'),
  ]);
  const invoiceData = Array.isArray(invoices) ? invoices : invoices.data;
  const totalInvoices = Array.isArray(invoices) ? invoices.length : invoices.total;
  (window as any).__invMaterials = materials;
  (window as any).__invDefaultTax = settings.value || '0';
  const categories = [...new Set(materials.map((m: Material) => m.category).filter(Boolean))];
  const filteredMaterials = materials.filter((m: Material) => (!posCategory || m.category === posCategory) && (!posSearch || `${m.name} ${m.category} ${m.unit}`.toLowerCase().includes(posSearch.toLowerCase())));
  const categoryButtons = categories.map(c => {
    const safeCategory = c.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `<button class="pos-category ${posCategory === c ? 'active' : ''}" onclick="setPOSCategory('${safeCategory}')">${esc(c)}</button>`;
  }).join('');
  const cartTotal = posCart.reduce((sum, item) => sum + item.quantity * Number(item.material.price_per_unit), 0);
  const taxRate = Number(settings.value || 0);
  const tax = Math.round(cartTotal * taxRate * 100) / 100;
  const total = Math.round((cartTotal + tax) * 100) / 100;
  (window as any).__posTotal = total;
  return `<div class="pos-page">
    <div class="pos-header"><div><div class="pos-kicker">Jeg Enterprises POS</div><h2>Point of Sale</h2></div><button class="btn" onclick="exportSalesHistory()">Export Sales History</button></div>
    <div class="pos-layout">
      <aside class="pos-categories"><div class="pos-panel-title">Categories</div><button class="pos-category ${!posCategory ? 'active' : ''}" onclick="setPOSCategory('')">All Categories</button>${categoryButtons}</aside>
      <section class="pos-products"><div class="pos-search"><input id="pos-search" type="search" value="${esc(posSearch)}" placeholder="Search material name, category, or unit..." oninput="filterPOSMaterials(this.value)" /><button class="btn btn-sm pos-camera-btn" onclick="startPOSCameraScan()" title="Scan barcode with camera">Scan Barcode</button><span>${filteredMaterials.length} item${filteredMaterials.length === 1 ? '' : 's'}</span></div><div class="pos-product-grid">${filteredMaterials.length ? filteredMaterials.map((m: Material) => `<button class="pos-product ${Number(m.stock) <= Number(m.reorder_point) ? 'low-stock' : ''}" onclick="addPOSItem('${m.id}')"><span class="pos-product-name">${esc(m.name)}</span><span class="pos-product-meta">${esc(m.unit)} · ${m.stock} in stock</span><strong>${fmtPeso(m.price_per_unit)}</strong></button>`).join('') : '<div class="pos-empty">No materials match your search.</div>'}</div></section>
      <aside class="pos-cart-panel"><div class="pos-panel-title pos-cart-title"><span>Current Sale</span><button class="pos-cart-toggle" onclick="togglePOSCart()" aria-expanded="false">Cart · ${posCart.length} · ${fmtPeso(total)}</button></div><div class="pos-cart-items">${posCart.length ? posCart.map(item => `<div class="pos-cart-item"><div class="pos-cart-info"><strong>${esc(item.material.name)}</strong><span>${fmtPeso(item.material.price_per_unit)} · ${esc(item.material.unit)}</span></div><div class="pos-qty"><button onclick="changePOSQty('${item.material.id}',-1)">−</button><strong>${item.quantity}</strong><button onclick="changePOSQty('${item.material.id}',1)">+</button></div><strong class="pos-line-total">${fmtPeso(item.quantity * Number(item.material.price_per_unit))}</strong><button class="pos-remove" onclick="removePOSItem('${item.material.id}')" aria-label="Remove item">×</button></div>`).join('') : '<div class="pos-cart-empty">Select a material to start a sale.</div>'}</div>
        <div class="pos-customer-box"><div id="pos-credit-fields"><label for="pos-credit-name">Name <span id="pos-name-required">(optional unless Credit)</span></label><input id="pos-credit-name" maxlength="120" placeholder="Buyer or charge-to name" /><label for="pos-credit-address">Address <span>(optional)</span></label><input id="pos-credit-address" maxlength="250" placeholder="Buyer address" /><label for="pos-credit-notes">Notes <span>(optional)</span></label><input id="pos-credit-notes" maxlength="250" placeholder="Sale notes" /></div></div>
        <div class="pos-summary"><div><span>Subtotal</span><strong>${fmtPeso(cartTotal)}</strong></div>${taxRate > 0 ? `<div><span>Tax</span><strong>${fmtPeso(tax)}</strong></div>` : ''}<div class="pos-grand-total"><span>Total</span><strong>${fmtPeso(total)}</strong></div></div>
        <div class="pos-payment"><label for="pos-method">Payment Method</label><select id="pos-method" onchange="updatePOSPayment()"><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank Transfer</option><option value="gcash">GCash</option><option value="check">Check</option><option value="credit">Credit / On Account</option></select><div id="pos-credit-warning" class="pos-credit-warning" role="status">Credit sales require a Charge To / Buyer Name.</div><div id="pos-cash-fields"><label for="pos-received">Amount Received</label><input id="pos-received" type="number" min="0" step="0.01" value="${total.toFixed(2)}" oninput="updatePOSPayment()" /><div class="pos-change"><span>Change</span><strong id="pos-change-value">${fmtPeso(0)}</strong></div></div></div>
        <button class="btn btn-primary pos-complete" id="pos-complete-btn" onclick="completePOSSale()" ${posCart.length ? '' : 'disabled'}>Complete Sale</button><button class="btn pos-clear" onclick="clearPOSCart()" ${posCart.length ? '' : 'disabled'}>Clear Cart</button>
      </aside>
    </div>
    <details class="pos-history"><summary>Sales History <span>${totalInvoices} invoice${totalInvoices === 1 ? '' : 's'}</span></summary><div class="table-wrap"><table><thead><tr><th>#</th><th>Customer</th><th>Total</th><th>Status</th><th>Issued</th><th>Delivery Person</th><th class="actions">Actions</th></tr></thead><tbody>${invoiceData.length ? invoiceData.map((inv: Invoice) => `<tr><td data-label="#" style="font-weight:600">${esc(inv.invoice_number)}</td><td data-label="Customer">${esc(inv.customer_name)}</td><td data-label="Total" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(inv.total)}</td><td data-label="Status"><span class="status-badge ${inv.status}">${inv.status}</span></td><td data-label="Issued">${fmtDate(inv.issued_date)}</td><td data-label="Delivery Person"><span class="delivery-value">${esc(inv.delivery_person || 'Not assigned')}</span><button class="btn btn-sm delivery-edit-btn" onclick="showDeliveryModal('${inv.id}')">${inv.delivery_person ? 'Edit' : 'Assign'}</button></td><td data-label="" class="actions"><button class="btn btn-success btn-sm" onclick="showInvoiceDetail('${inv.id}')">View</button><button class="btn btn-danger btn-sm" onclick="delInvoice('${inv.id}')">Delete</button></td></tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--c-text-muted);padding:2rem">No sales yet</td></tr>'}</tbody></table></div>${totalInvoices > INVOICE_PAGE_SIZE ? `<div class="pagination"><span>Showing ${(invoicePage-1)*INVOICE_PAGE_SIZE+1}–${Math.min(invoicePage*INVOICE_PAGE_SIZE, totalInvoices)} of ${totalInvoices}</span><button class="btn btn-sm" ${invoicePage===1?'disabled':''} onclick="changeInvoicePage(${invoicePage-1})">Previous</button><strong>Page ${invoicePage} of ${Math.ceil(totalInvoices/INVOICE_PAGE_SIZE)}</strong><button class="btn btn-sm" ${invoicePage>=Math.ceil(totalInvoices/INVOICE_PAGE_SIZE)?'disabled':''} onclick="changeInvoicePage(${invoicePage+1})">Next</button></div>` : ''}</details>
  </div>`;
}

export function exportSalesHistory() {
  showExportPeriodModal('Sales History', async (period: ExportPeriod, format) => {
    const result = await apiGet<any>(`/invoices?export=1&from=${period.from}&to=${period.to}&page=1&pageSize=100`);
    const rows = (result.data || []).map((inv: any) => [inv.invoice_number, inv.customer_name, fmtDate(inv.issued_date), inv.status, fmtPeso(inv.adjusted_total ?? inv.total), fmtPeso(inv.net_paid || 0), inv.delivery_person || '—']);
    exportTable('Sales History', period, ['Invoice', 'Buyer', 'Issued', 'Status', 'Total', 'Paid', 'Delivery Person'], rows, format, `${rows.length} sale${rows.length === 1 ? '' : 's'}`);
  });
}

export function changeInvoicePage(page: number) { invoicePage = Math.max(1, page); loadView('invoices'); }

export async function showDeliveryModal(invoiceId: string) {
  try {
    const invoice = await apiGet<any>(`/invoices/${invoiceId}`);
    showModal(`<h3>Assign Delivery Person</h3><p class="modal-help">Delivery can be assigned or updated after the sale.</p><div class="form-group"><label for="delivery-person-edit">Delivery Person <span>(optional)</span></label><input id="delivery-person-edit" maxlength="100" value="${esc(invoice.delivery_person || '')}" placeholder="Enter delivery person name" /></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveDeliveryPerson('${invoiceId}')">Save</button></div>`, 'delivery-modal');
  } catch (e: any) { showToast(e.message || 'Unable to load invoice'); }
}

export async function saveDeliveryPerson(invoiceId: string) {
  const value = (document.getElementById('delivery-person-edit') as HTMLInputElement)?.value.trim() || null;
  try { await apiPut(`/invoices/${invoiceId}/delivery`, { delivery_person: value }); closeModal(); showToast('Delivery person updated', 'success'); loadView('invoices'); }
  catch (e: any) { showToast(e.message || 'Unable to update delivery person'); }
}

export function setPOSCategory(category: string) { posCategory = category; loadView('invoices'); }
export function filterPOSMaterials(value: string) { posSearch = value; renderPOSProductGrid(); }
export function togglePOSCart() {
  const page = document.querySelector('.pos-page');
  const toggle = document.querySelector('.pos-cart-toggle');
  if (!page || !toggle) return;
  const open = page.classList.toggle('pos-cart-open');
  toggle.setAttribute('aria-expanded', String(open));
}
function renderPOSProductGrid() {
  const grid = document.querySelector('.pos-product-grid');
  const count = document.querySelector('.pos-search span');
  const materials: Material[] = (window as any).__invMaterials || [];
  const filtered = materials.filter(m => (!posCategory || m.category === posCategory) && (!posSearch || `${m.name} ${m.category} ${m.unit} ${m.barcode || ''}`.toLowerCase().includes(posSearch.toLowerCase())));
  if (count) count.textContent = `${filtered.length} item${filtered.length === 1 ? '' : 's'}`;
  if (grid) grid.innerHTML = filtered.length ? filtered.map(m => `<button class="pos-product ${Number(m.stock) <= Number(m.reorder_point) ? 'low-stock' : ''}" onclick="addPOSItem('${m.id}')"><span class="pos-product-name">${esc(m.name)}</span><span class="pos-product-meta">${esc(m.unit)} · ${m.stock} in stock</span><strong>${fmtPeso(m.price_per_unit)}</strong></button>`).join('') : '<div class="pos-empty">No materials match your search.</div>';
}
export function addPOSItem(id: string) {
  const material = ((window as any).__invMaterials || []).find((m: Material) => m.id === id) as Material | undefined;
  if (!material) return;
  const existing = posCart.find(item => item.material.id === id);
  if (existing) { if (existing.quantity < Number(material.stock)) existing.quantity += 1; else showToast(`Only ${material.stock} ${material.unit} available`); }
  else if (Number(material.stock) > 0) posCart.push({ material, quantity: 1 });
  else showToast(`${material.name} is out of stock`);
  loadView('invoices');
}
export function changePOSQty(id: string, delta: number) { const item = posCart.find(i => i.material.id === id); if (!item) return; const next = item.quantity + delta; if (next <= 0) posCart = posCart.filter(i => i.material.id !== id); else if (next <= Number(item.material.stock)) item.quantity = next; else showToast(`Only ${item.material.stock} ${item.material.unit} available`); loadView('invoices'); }
export function removePOSItem(id: string) { posCart = posCart.filter(i => i.material.id !== id); loadView('invoices'); }
export function clearPOSCart() { posCart = []; loadView('invoices'); }
export function updatePOSPayment() { const total = getPOSCurrentTotal(); const received = Number((document.getElementById('pos-received') as HTMLInputElement)?.value || 0); const method = (document.getElementById('pos-method') as HTMLSelectElement)?.value; const fields = document.getElementById('pos-cash-fields'); const warning = document.getElementById('pos-credit-warning'); const required = document.getElementById('pos-name-required'); if (fields) fields.style.display = method === 'credit' ? 'none' : ''; if (warning) warning.style.display = method === 'credit' ? 'block' : 'none'; if (required) required.textContent = method === 'credit' ? '* required for Credit' : '(optional unless Credit)'; const change = method === 'cash' ? Math.max(0, received - total) : 0; const target = document.getElementById('pos-change-value'); if (target) target.textContent = fmtPeso(change); const btn = document.getElementById('pos-complete-btn') as HTMLButtonElement | null; if (btn) btn.disabled = !posCart.length; }
export async function completePOSSale() {
  if (!posCart.length) { showToast('Add at least one material'); return; }
  const total = getPOSCurrentTotal();
  const method = (document.getElementById('pos-method') as HTMLSelectElement)?.value || 'cash';
  const received = Number((document.getElementById('pos-received') as HTMLInputElement)?.value || 0);
  if (method === 'cash' && received < total) { showToast(`Amount received is short by ${fmtPeso(total - received)}`); return; }
  const credit_account_name = (document.getElementById('pos-credit-name') as HTMLInputElement)?.value.trim() || '';
  const buyer_address = (document.getElementById('pos-credit-address') as HTMLInputElement)?.value.trim() || '';
  const notes = (document.getElementById('pos-credit-notes') as HTMLInputElement)?.value.trim() || '';
  if (method === 'credit' && !credit_account_name) { showToast('Enter the buyer or charge-to name for a credit sale'); (document.getElementById('pos-credit-name') as HTMLInputElement)?.focus(); return; }
  const items = posCart.map(item => ({ material_id: item.material.id, description: item.material.name, quantity: item.quantity, unit_price: Number(item.material.price_per_unit) }));
  const customer_id = null;
  const btn = document.getElementById('pos-complete-btn') as HTMLButtonElement | null; if (btn) btn.disabled = true;
  try {
    // POS checkout is committed atomically by the backend. Credit creates an unpaid invoice.
    const checkout = await apiPost<any>('/invoices', { customer_id, due_date: null, credit_account_name: credit_account_name || null, buyer_address: buyer_address || null, notes: notes || null, tax_rate: Number((window as any).__invDefaultTax || 0), items, payment: { amount: method === 'credit' ? 0 : total, method, notes: '' } });
    const change = method === 'cash' ? received - total : 0;
    posCart = [];
    await showReceiptPreview(checkout.id);
    if (change > 0) showToast(`Sale completed. Change: ${fmtPeso(change)}`, 'success');
    else showToast('Sale completed', 'success');
    loadView('invoices');
  } catch (e: any) { showToast(e.message || 'Unable to complete sale'); if (btn) btn.disabled = false; }
}

export async function showInvoiceDetail(id: string) {
  const inv = await apiGet<Invoice>(`/invoices/${id}`);
  const totalPaid = inv.payments.reduce((s: number, p: any) => s + p.amount, 0) - ((inv as any).refunds || []).reduce((s: number, r: any) => s + r.amount, 0);
  const adjustedTotal = Number((inv as any).adjusted_total ?? inv.total);
  const balance = adjustedTotal - totalPaid;
  const returnedTotal = (inv.items || []).reduce((s: number, item: any) => s + Number(item.returned_total || 0), 0);
  const refundedTotal = ((inv as any).refunds || []).reduce((s: number, refund: any) => s + Number(refund.amount || 0), 0);
  const modalId = 'invoice-detail-modal';
  document.getElementById(modalId)?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = modalId;
  modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); loadView('invoices'); } });
  document.body.appendChild(modal);
  modal.innerHTML = `<div class="modal-content invoice-detail-modal-content"><div class="invoice-detail-scroll">
    <h3>Invoice ${esc(inv.invoice_number)}</h3>
    <div style="display:flex;gap:var(--space-4);align-items:center;margin-bottom:var(--space-4);flex-wrap:wrap">
      <span style="color:var(--c-text-secondary)">${esc(inv.customer_name)}</span>
      <span class="status-badge ${inv.status}">${inv.status}</span>
      <span style="font-size:var(--fs-xs);color:var(--c-text-muted)">Issued: ${fmtDate(inv.issued_date)}</span>
      ${inv.paid_date ? `<span style="font-size:var(--fs-xs);color:var(--c-success)">Paid: ${fmtDate(inv.paid_date)}</span>` : ''}
    </div>

    <h4>Line Items</h4>
    <div class="table-wrap" style="margin-bottom:1rem">
      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
        <tbody>
          ${inv.items.map((item: any) => `
            <tr><td data-label="Description">${esc(item.description)}</td><td data-label="Qty">${item.quantity}</td><td data-label="Unit Price" style="font-family:var(--ff-mono)">${fmtPeso(item.unit_price)}</td><td data-label="Total" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(item.total)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div style="max-width:300px;margin-left:auto">
      <div class="summary-line"><span>Subtotal</span><span>${fmtPeso(inv.subtotal)}</span></div>
      ${Number(inv.tax_rate) > 0 ? `<div class="summary-line"><span>Tax (${(Number(inv.tax_rate)*100).toFixed(0)}%)</span><span>${fmtPeso(inv.tax_amount)}</span></div>` : ''}
      <div class="summary-line"><span>Original Total</span><span>${fmtPeso(inv.total)}</span></div>
      ${returnedTotal > 0 ? `<div class="summary-line"><span>Returns</span><span style="color:var(--c-warning)">−${fmtPeso(returnedTotal)}</span></div>` : ''}
      ${adjustedTotal !== Number(inv.total) ? `<div class="summary-line"><span>Adjusted Total</span><span>${fmtPeso(adjustedTotal)}</span></div>` : ''}
      <div class="summary-line"><span>Paid</span><span style="color:var(--c-success)">${fmtPeso(totalPaid)}</span></div>
      ${refundedTotal > 0 ? `<div class="summary-line"><span>Refunded</span><span style="color:var(--c-warning)">−${fmtPeso(refundedTotal)}</span></div>` : ''}
      <div class="summary-line" style="font-weight:600;font-size:var(--fs-lg)"><span>Balance</span><span style="color:${balance < 0 ? 'var(--c-warning)' : balance > 0 ? 'var(--c-danger)' : 'var(--c-success)'}">${fmtPeso(balance)}</span></div>
    </div>

    ${inv.payments.length ? `
    <h4>Payments</h4>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Notes</th></tr></thead>
        <tbody>
          ${inv.payments.map((p: any) => `
            <tr><td data-label="Date">${fmtDate(p.payment_date)}</td><td data-label="Amount" style="font-family:var(--ff-mono);font-weight:600;color:var(--c-success)">${fmtPeso(p.amount)}</td><td data-label="Method">${esc(p.method)}</td><td data-label="Notes" style="color:var(--c-text-muted)">${esc(p.notes || '—')}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${(inv as any).credit_memos?.length ? `<h4>Credit Memos</h4><div class="table-wrap"><table><thead><tr><th>Number</th><th>Reason</th><th>Amount</th><th>Date</th></tr></thead><tbody>${(inv as any).credit_memos.map((cm: any) => `<tr><td>${esc(cm.memo_number)}</td><td>${esc(cm.reason)}</td><td>${fmtPeso(cm.amount)}</td><td>${fmtDate(cm.created_at)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${(inv as any).refunds?.length ? `<h4>Refunds</h4><div class="table-wrap"><table><thead><tr><th>Method</th><th>Amount</th><th>Reference</th><th>Date</th></tr></thead><tbody>${(inv as any).refunds.map((rf: any) => `<tr><td>${esc(rf.method)}</td><td>${fmtPeso(rf.amount)}</td><td>${esc(rf.reference || '—')}</td><td>${fmtDate(rf.created_at)}</td></tr>`).join('')}</tbody></table></div>` : ''}

    ${balance > 0 && inv.status !== 'voided' ? `
    <h4>Record Payment</h4>
    <div style="display:flex;gap:0.75rem;align-items:end;flex-wrap:wrap">
      <div class="form-group" style="flex:1;min-width:120px"><label>Amount</label><input id="pay-amount" type="number" step="0.01" min="0.01" max="${balance.toFixed(2)}" value="${balance.toFixed(2)}" /></div>
      <div class="form-group" style="flex:1;min-width:120px"><label>Method</label>
        <select id="pay-method">
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="check">Check</option>
          <option value="bank">Bank Transfer</option>
          <option value="gcash">GCash</option>
        </select>
      </div>
      <div class="form-group" style="flex:1;min-width:120px"><label>Notes</label><input id="pay-notes" maxlength="200" /></div>
      <button class="btn btn-success" id="pay-btn" onclick="recordPayment('${inv.id}')" style="margin-bottom:1rem">Pay</button>
    </div>
    <div class="field-error" id="pay-err"></div>
    ` : '<p style="color:var(--c-success);font-weight:600;margin-top:1rem">✓ Paid in Full</p>'}

    ${inv.status !== 'pending' && inv.status !== 'voided' ? `
    <h4 style="margin-top:var(--space-5)">Return Items</h4>
    <div id="return-items">
      ${inv.items.map((item: any) => `
        <div class="line-item" style="margin-bottom:var(--space-2)">
          <span style="flex:2;font-size:var(--fs-sm)">${esc(item.description)}</span>
          <span style="flex:1;font-size:var(--fs-sm);color:var(--c-text-muted)">Sold: ${item.quantity}<br>Returned: ${Number(item.returned_quantity || 0)}<br><strong>Remaining: ${Number(item.remaining_quantity ?? item.quantity)}</strong></span>
          <input id="ret-qty-${item.id}" type="number" min="0" max="${Number(item.remaining_quantity ?? item.quantity)}" value="0" ${Number(item.remaining_quantity ?? item.quantity) <= 0 ? 'disabled' : ''} aria-label="Return quantity for ${esc(item.description)}" style="flex:1;min-height:32px;font-size:var(--fs-sm);width:60px" />
        </div>
      `).join('')}
    </div>
    <button class="btn btn-warning" id="ret-btn" onclick="returnItems('${inv.id}')" style="margin-top:var(--space-2)">Process Returns</button>
    <div class="field-error" id="ret-err"></div>
    ` : ''}

    <div class="modal-actions">
      <button class="btn btn-primary" onclick="showReceiptPreview('${inv.id}')">Print Receipt</button>
      ${isAdmin() && inv.status !== 'voided' ? `<button class="btn btn-warning" onclick="voidInvoice('${inv.id}')">Void Invoice</button><button class="btn" onclick="issueCreditMemo('${inv.id}')">Credit Memo</button>${totalPaid > 0 ? `<button class="btn" onclick="recordRefund('${inv.id}')">Refund</button>` : ''}` : ''}
      <button class="btn" onclick="closeModal();loadView('invoices')">Close</button>
    </div>
  </div><div class="modal-scroll-hint" aria-hidden="true"><span>↓</span> More details below</div></div>`;
  const detailScroll = modal.querySelector('.invoice-detail-scroll') as HTMLElement | null;
  const scrollHint = modal.querySelector('.modal-scroll-hint') as HTMLElement | null;
  const updateScrollHint = () => {
    if (!detailScroll || !scrollHint) return;
    const hasMore = detailScroll.scrollHeight > detailScroll.clientHeight + 8;
    const atBottom = detailScroll.scrollTop + detailScroll.clientHeight >= detailScroll.scrollHeight - 8;
    scrollHint.classList.toggle('is-hidden', !hasMore || atBottom);
  };
  detailScroll?.addEventListener('scroll', updateScrollHint, { passive: true });
  requestAnimationFrame(updateScrollHint);
}

export async function voidInvoice(id: string) {
  showModal(`<h3>Void Invoice</h3><div class="form-group"><label for="void-reason">Reason *</label><input id="void-reason" maxlength="200" autofocus placeholder="Enter reason" /><div class="field-error" id="void-reason-err"></div></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="submitVoidInvoice('${id}')">Void Invoice</button></div>`, 'invoice-action-modal');
}
export async function submitVoidInvoice(id: string) {
  const reason = val('void-reason').trim(); if (reason.length < 3) { setErr('void-reason-err', 'Enter at least 3 characters'); return; }
  try { await apiPut(`/invoices/${id}/void`, { reason }); showToast('Invoice voided and stock restored', 'success'); closeModal(); loadView('invoices'); }
  catch (e: any) { showToast(e.message); }
}

export async function issueCreditMemo(id: string) {
  showModal(`<h3>Issue Credit Memo</h3><div class="form-group"><label for="memo-amount">Amount *</label><input id="memo-amount" type="number" min="0.01" step="0.01" autofocus placeholder="0.00" /></div><div class="form-group"><label for="memo-reason">Reason *</label><input id="memo-reason" maxlength="200" placeholder="Enter reason" /></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitCreditMemo('${id}')">Issue Memo</button></div>`, 'invoice-action-modal');
}
export async function submitCreditMemo(id: string) {
  const amount = Number(val('memo-amount')); const reason = val('memo-reason').trim();
  if (!Number.isFinite(amount) || amount <= 0 || reason.length < 3) { showToast('Enter a valid amount and reason'); return; }
  try { await apiPost(`/invoices/${id}/credit-memo`, { amount, reason }); showToast('Credit memo issued', 'success'); closeModal(); loadView('invoices'); }
  catch (e: any) { showToast(e.message); }
}

export async function recordRefund(id: string, suggestedAmount = 0, returnView = 'invoices') {
  let shifts: any[] = [];
  try { shifts = await apiGet<any[]>('/shifts/active'); } catch { /* non-cash refunds remain available if shift lookup fails */ }
  const shiftOptions = shifts.map(shift => `<option value="${esc(shift.id)}">${esc(shift.username || 'Cashier')} · ${fmtPeso(shift.expected_cash)}</option>`).join('');
  showModal(`<h3>Record Refund</h3><p class="modal-help">A refund records money returned to the buyer. It is separate from the stock return.</p>${suggestedAmount > 0 ? `<p class="field-help">Maximum available refund: <strong>${fmtPeso(suggestedAmount)}</strong></p>` : ''}<div class="form-group"><label for="refund-amount">Amount *</label><input id="refund-amount" type="number" min="0.01" ${suggestedAmount > 0 ? `max="${suggestedAmount.toFixed(2)}"` : ''} step="0.01" value="${suggestedAmount > 0 ? suggestedAmount.toFixed(2) : ''}" autofocus placeholder="0.00" /></div><div class="form-group"><label for="refund-method">Refund method *</label><select id="refund-method" onchange="document.getElementById('refund-shift-wrap')?.classList.toggle('is-hidden', this.value !== 'cash')"><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank Transfer</option><option value="gcash">GCash</option><option value="check">Check</option></select></div><div id="refund-shift-wrap" class="form-group"><label for="refund-shift">Cashier shift *</label>${shiftOptions ? `<select id="refund-shift"><option value="">Select active shift...</option>${shiftOptions}</select>` : '<p class="field-help">No active cashier shift is available for a cash refund.</p>'}</div><div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitRefund('${id}', '${returnView}')">Record Refund</button></div>`, 'invoice-action-modal');
}
export async function submitRefund(id: string, returnView = 'invoices') {
  const amount = Number(val('refund-amount')); const method = val('refund-method');
  if (!Number.isFinite(amount) || amount <= 0 || !method) { showToast('Enter a valid amount and method'); return; }
  const shiftId = method === 'cash' ? val('refund-shift') : undefined;
  if (method === 'cash' && !shiftId) { showToast('Select an active cashier shift for a cash refund'); return; }
  const max = Number((document.getElementById('refund-amount') as HTMLInputElement)?.max || 0);
  if (max > 0 && amount > max + 0.005) { showToast(`Refund cannot exceed ${fmtPeso(max)}`); return; }
  try { await apiPost(`/invoices/${id}/refund`, { amount, method, ...(shiftId ? { shift_id: shiftId } : {}) }); showToast('Refund recorded', 'success'); closeModal(); loadView(returnView); }
  catch (e: any) { showToast(e.message); }
}

export async function recordPayment(invoiceId: string) {
  clearErr('pay-err');
  const amount = parseFloat(val('pay-amount'));
  const method = val('pay-method');
  const notes = val('pay-notes');
  if (isNaN(amount) || amount <= 0) { setErr('pay-err', 'Enter a valid amount'); return; }
  const payInput = document.getElementById('pay-amount') as HTMLInputElement;
  const max = parseFloat(payInput?.getAttribute('max') || '0');
  if (max > 0 && amount > max) { setErr('pay-err', `Amount exceeds remaining balance of ${fmtPeso(max)}`); return; }
  const confirmHtml = `
    <h3>Confirm Payment</h3>
    <p style="margin-bottom:var(--space-4);color:var(--c-text-secondary)">Record this payment?</p>
    <div class="summary-line"><span>Amount</span><span>${fmtPeso(amount)}</span></div>
    <div class="summary-line"><span>Method</span><span>${esc(method)}</span></div>
    ${notes ? `<div class="summary-line"><span>Notes</span><span>${esc(notes)}</span></div>` : ''}
  `;
  if (!(await showConfirmModal(confirmHtml))) return;
  disableBtn('pay-btn', true);
  try {
    await apiPost(`/invoices/${invoiceId}/pay`, { amount, method, notes });
    closeModal();
    loadView('invoices');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('pay-btn', false); }
}

export async function delInvoice(id: string) {
  const ok = await showConfirmModal(`<h3>Delete Invoice</h3><p style="color:var(--c-text-secondary)">Are you sure you want to delete this invoice? Stock will be restored.</p>`);
  if (!ok) return;
  try { await apiDel(`/invoices/${id}`); loadView('invoices'); }
  catch (e: any) { showToast(e.message); }
}

export async function returnItems(invoiceId: string) {
  disableBtn('ret-btn', true);
  try {
    const inv = await apiGet<any>(`/invoices/${invoiceId}`);
    const retItems: { material_id: string; quantity: number }[] = [];
    for (const item of inv.items) {
      if (!item.material_id) continue;
      const qty = parseFloat((document.getElementById(`ret-qty-${item.id}`) as HTMLInputElement)?.value || '0');
      const remaining = Number(item.remaining_quantity ?? item.quantity);
      if (qty > 0 && qty <= remaining) {
        retItems.push({ invoice_item_id: item.id, material_id: item.material_id, quantity: qty } as any);
      }
    }
    if (!retItems.length) { showToast('Enter return quantities'); return; }
    const ok = await showConfirmModal(`<h3>Confirm Returns</h3><p style="color:var(--c-text-secondary)">Return ${retItems.length} item(s) and restore stock?</p>`);
    if (!ok) return;
    const returnTotal = retItems.reduce((sum, returned) => {
      const original = inv.items.find((item: any) => item.id === returned.invoice_item_id);
      return sum + (Number(original?.unit_price || 0) * returned.quantity * (1 + Number(inv.tax_rate || 0)));
    }, 0);
    await apiPost(`/invoices/${invoiceId}/return`, { items: retItems });
    closeModal();
    showModal(`<h3>Return processed</h3><p class="modal-help">The returned stock was restored successfully.</p><div class="info-callout"><strong>Money not refunded yet.</strong><br>Use Record Refund only if money will be given back to the customer. A cash refund will automatically reduce the expected cash in the selected cashier shift.</div><div class="modal-actions"><button class="btn" onclick="closeModal();loadView('invoices')">Close</button><button class="btn btn-primary" onclick="recordRefund('${invoiceId}', ${Math.round(returnTotal * 100) / 100})">Record Refund</button></div>`, 'invoice-action-modal');
  } catch (e: any) { showToast(e.message); }
  finally { disableBtn('ret-btn', false); }
}
