import { apiGet } from '../lib/api';
import { esc, fmtDate, fmtPeso, numberToWords } from '../lib/helpers';
import { showToast } from '../lib/helpers';
import type { Invoice } from '../lib/types';

type ReceiptContext = {
  inv: Invoice;
  settings: Record<string, string>;
  dateStr: string;
  timeStr: string;
  totalPaid: number;
  adjustedTotal: number;
  balance: number;
  isVat: boolean;
  vatRate: number;
  vatAmount: number;
};

export async function printReceipt(id: string) {
  try {
    const bluetooth = (navigator as any).bluetooth;
    if (!bluetooth) {
      showToast('Web Bluetooth is not supported in this browser. Use Chrome or Edge over HTTPS with a BLE thermal printer.');
      return;
    }

    // Request the printer before awaiting API calls so the browser preserves
    // the click gesture required to open the Bluetooth chooser.
    const device = await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '0000ffe0-0000-1000-8000-00805f9b34fb',
        '000018f0-0000-1000-8000-00805f9b34fb',
        '0000ff00-0000-1000-8000-00805f9b34fb',
      ],
    });
    if (!device?.gatt) throw new Error('Selected device does not support Bluetooth printing');
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const characteristic = await findPrinterCharacteristic(server);
    if (!characteristic) throw new Error('Could not find a writable printer characteristic. Check that the printer is BLE/ESC-POS compatible.');

    const receipt = await loadReceiptContext(id);
    await writeThermalReceipt(characteristic, buildThermalReceipt(receipt));
    showToast(`Receipt sent to ${device.name || 'thermal printer'}`, 'success');
  } catch (e: any) {
    if (e?.name === 'NotFoundError') showToast('No Bluetooth printer was selected');
    else showToast(e?.message || 'Unable to print receipt');
  }
}

export async function printShift(id: string) {
  try {
    const bluetooth = (navigator as any).bluetooth;
    if (!bluetooth) { showToast('Web Bluetooth is not supported in this browser. Use Chrome or Edge over HTTPS with a BLE thermal printer.'); return; }
    const device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
    if (!device?.gatt) throw new Error('Selected device does not support Bluetooth printing');
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const characteristic = await findPrinterCharacteristic(server);
    if (!characteristic) throw new Error('Could not find a writable thermal printer characteristic');
    const shift = await apiGet<any>(`/shifts/${id}`);
    await writeThermalReceipt(characteristic, buildThermalShift(shift));
    showToast(`Shift report sent to ${device.name || 'thermal printer'}`, 'success');
  } catch (e: any) {
    if (e?.name === 'NotFoundError') showToast('No Bluetooth printer was selected');
    else showToast(e?.message || 'Unable to print shift report');
  }
}

function buildThermalShift(shift: any): Uint8Array {
  const encoder = new TextEncoder(); const width = 42; const line = '-'.repeat(width);
  const safe = (value: any) => String(value ?? '—').replace(/[\r\n]/g, ' ').trim();
  const row = (label: string, value: string) => label.padEnd(Math.max(1, width - value.length)) + value;
  const variance = Number(shift.variance || 0);
  const methods = shift.payment_methods || {};
  const refunds = shift.refund_methods || {};
  const methodRows = [
    row('Cash', fmtPeso(methods.cash)), row('GCash', fmtPeso(methods.gcash)), row('Card', fmtPeso(methods.card)),
    row('Bank Transfer', fmtPeso(methods.bank)), row('Check', fmtPeso(methods.check)),
    row('Total Collections', fmtPeso(shift.total_collections)),
  ];
  const refundRows = [
    row('Cash', fmtPeso(refunds.cash)), row('GCash', fmtPeso(refunds.gcash)), row('Card', fmtPeso(refunds.card)),
    row('Bank Transfer', fmtPeso(refunds.bank)), row('Check', fmtPeso(refunds.check)),
  ];
  const content = [
    '\x1b@', '\x1b\x61\x01', 'JEG ENTERPRISES', 'CASHIER SHIFT REPORT', '\x1b\x61\x00', line,
    row('Cashier', safe(shift.username)), row('Opened', safe(shift.opened_at)), row('Closed', safe(shift.closed_at)), line,
    row('Opening Cash', fmtPeso(shift.opening_cash)), row('Cash Sales', fmtPeso(shift.cash_sales)), row('Cash Refunds', fmtPeso(shift.cash_refunds)), row('Drawer Adjustments', fmtPeso(shift.drawer_events)), line,
    '\x1b\x61\x01', 'PAYMENT METHODS', '\x1b\x61\x00', line, ...methodRows, line,
    '\x1b\x61\x01', 'REFUNDS BY METHOD', '\x1b\x61\x00', line, ...refundRows, line,
    row('EXPECTED CASH', fmtPeso(shift.expected_cash)), row('COUNTED CASH', fmtPeso(shift.closing_cash)), row(variance >= 0 ? 'OVER' : 'SHORT', fmtPeso(Math.abs(variance))), line,
    `Notes: ${safe(shift.notes)}`, '', 'For internal cashier reconciliation', '\x1b\x64\x04', '\x1d\x56\x00',
  ].join('\n') + '\n';
  return encoder.encode(content);
}

async function loadReceiptContext(id: string): Promise<ReceiptContext> {
  const inv = await apiGet<Invoice>(`/invoices/${id}`);
  let settings: Record<string, string> = {};
  try { settings = await apiGet<Record<string, string | null>>('/settings?keys=business_name,business_address,business_tin,business_rdo,vat_registered') as Record<string, string>; } catch { /* Defaults are shown in the preview/printout. */ }
  const totalPaid = (inv.payments || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0) - ((inv as any).refunds || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const adjustedTotal = Number((inv as any).adjusted_total ?? inv.total ?? 0);
  const balance = adjustedTotal - totalPaid;
  const issuedDate = new Date(String(inv.issued_date || new Date().toISOString()).replace(' ', 'T'));
  const isVat = settings.vat_registered === '1' || Number(inv.tax_rate) > 0;
  return { inv, settings, dateStr: issuedDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }), timeStr: issuedDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }), totalPaid, adjustedTotal, balance, isVat, vatRate: isVat ? Number(inv.tax_rate) : 0, vatAmount: Number((inv as any).adjusted_tax ?? inv.tax_amount ?? 0) };
}

export async function showReceiptPreview(id: string) {
  try {
    const receipt = await loadReceiptContext(id);
    document.getElementById('receipt-preview-modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'modal receipt-preview-modal';
    modal.id = 'receipt-preview-modal';
    modal.innerHTML = `<div class="modal-content receipt-preview-content">
      <div class="receipt-preview-heading"><div><span class="help-eyebrow">Receipt Preview</span><h3>${esc(receipt.inv.invoice_number)}</h3></div><button class="help-close" aria-label="Close receipt preview">×</button></div>
      <p class="receipt-preview-note">This white paper preview represents the monochrome receipt sent to the Bluetooth thermal printer.</p>
      <div class="receipt-paper">${receiptPreviewHtml(receipt)}</div>
      <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button><button class="btn btn-primary" onclick="printReceipt('${id}')">Send to Bluetooth Printer</button></div>
    </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    modal.querySelector('.help-close')?.addEventListener('click', () => modal.remove());
    document.body.appendChild(modal);
  } catch (e: any) { showToast(e?.message || 'Unable to load receipt preview'); }
}

const PRINTER_SERVICES = [
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
];

async function findPrinterCharacteristic(server: any): Promise<any> {
  for (const serviceId of PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(serviceId);
      const characteristics = await service.getCharacteristics();
      const writable = characteristics.find((c: any) => c.properties?.write || c.properties?.writeWithoutResponse);
      if (writable) return writable;
    } catch { /* Try the next common BLE printer service. */ }
  }
  return null;
}

async function writeThermalReceipt(characteristic: any, text: Uint8Array) {
  const chunkSize = characteristic.properties?.writeWithoutResponse ? 180 : 100;
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    const chunk = text.slice(offset, Math.min(offset + chunkSize, text.length));
    if (characteristic.properties?.writeWithoutResponse && characteristic.writeValueWithoutResponse) await characteristic.writeValueWithoutResponse(chunk);
    else await characteristic.writeValue(chunk);
  }
}

function buildThermalReceipt({ inv, settings, dateStr, timeStr, totalPaid, adjustedTotal, balance, isVat, vatRate, vatAmount }: ReceiptContext): Uint8Array {
  const encoder = new TextEncoder();
  const width = 42;
  const line = '-'.repeat(width);
  const center = (s: string) => s.length >= width ? s.slice(0, width) : ' '.repeat(Math.floor((width - s.length) / 2)) + s;
  const row = (label: string, value: string) => label.padEnd(Math.max(1, width - value.length)) + value;
  const safe = (value: any, fallback = '') => String(value ?? fallback).replace(/[\r\n]/g, ' ').trim();
  const itemLines = (inv.items || []).flatMap((item: any) => {
    const name = safe(item.description, 'Item').slice(0, width);
    return [`${name}`, row(`  ${item.quantity} x ${fmtPeso(item.unit_price)}`, fmtPeso(item.total))];
  });
  const paymentMethods = (inv.payments || []).map((p: any) => safe(p.method)).join(', ') || '—';
  const content = [
    '\x1b@', '\x1b\x61\x01', safe(settings.business_name, 'Jeg Enterprises'),
    'Hardware & Building Materials Dealer', safe(settings.business_address, 'Business address not configured'),
    settings.business_tin ? `TIN: ${safe(settings.business_tin)}` : '',
    settings.business_rdo ? `RDO/Branch: ${safe(settings.business_rdo)}` : '', '\x1b\x61\x00', line,
    'RECEIPT', line,
    row('Document No.', safe(inv.invoice_number)), row('Date', dateStr), row('Time', timeStr),
    row('Sold To', safe((inv as any).customer_name, 'Walk-in')),
    (inv as any).buyer_address ? row('Address', safe((inv as any).buyer_address)) : '', line,
    'ITEMS', ...itemLines, line,
    isVat ? row('VATable Sales', fmtPeso(Math.max(0, adjustedTotal - vatAmount))) : '',
    isVat ? row(`VAT (${(vatRate * 100).toFixed(0)}%)`, fmtPeso(vatAmount)) : '',
    row('TOTAL AMOUNT DUE', fmtPeso(adjustedTotal)), line,
    `Amount in Words: ${safe(numberToWords(adjustedTotal))}`, line,
    row('Payment Received', fmtPeso(totalPaid)), row('Outstanding Balance', fmtPeso(balance)), row('Mode of Payment', paymentMethods),
    (inv as any).notes ? `Notes: ${safe((inv as any).notes)}` : '',
    '', 'Thank you for your purchase!', '\x1b\x64\x04', '\x1d\x56\x00',
  ].filter(Boolean).join('\n') + '\n';
  return encoder.encode(content);
}

function receiptPreviewHtml({ inv, settings, dateStr, timeStr, totalPaid, adjustedTotal, balance, isVat, vatRate, vatAmount }: ReceiptContext): string {
  const safe = (value: any, fallback = '') => esc(String(value ?? fallback));
  const rows = (inv.items || []).map((item: any) => `<tr class="receipt-item-name"><td colspan="4">${safe(item.description, 'Item')}</td></tr><tr class="receipt-item-meta"><td colspan="2">${safe(item.quantity)} x ${fmtPeso(item.unit_price)}</td><td colspan="2">${fmtPeso(item.total)}</td></tr>`).join('');
  const methods = (inv.payments || []).map((p: any) => safe(p.method)).join(', ') || '—';
  const tinLine = [settings.business_tin ? `TIN: ${safe(settings.business_tin)}` : '', settings.business_rdo ? `RDO/Branch: ${safe(settings.business_rdo)}` : ''].filter(Boolean).join(' · ');
  return `<div class="receipt-paper-header"><strong>${safe(settings.business_name, 'Jeg Enterprises')}</strong><span>Hardware &amp; Building Materials Dealer</span><span>${safe(settings.business_address, 'Business address not configured')}</span>${tinLine ? `<span>${tinLine}</span>` : ''}</div>
    <h4>RECEIPT</h4>
    <dl class="receipt-paper-info"><dt>Document No.</dt><dd>${safe(inv.invoice_number)}</dd><dt>Date</dt><dd>${safe(dateStr)}</dd><dt>Time</dt><dd>${safe(timeStr)}</dd><dt>Sold To</dt><dd>${safe((inv as any).customer_name, 'Walk-in')}</dd>${(inv as any).buyer_address ? `<dt>Address</dt><dd>${safe((inv as any).buyer_address)}</dd>` : ''}</dl>
    <table><thead><tr><th colspan="4">ITEMS</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="receipt-paper-total">${isVat ? `<div><span>VATable Sales</span><span>${fmtPeso(Math.max(0, adjustedTotal - vatAmount))}</span></div><div><span>VAT (${(vatRate * 100).toFixed(0)}%)</span><span>${fmtPeso(vatAmount)}</span></div>` : ''}<div class="grand"><span>TOTAL AMOUNT DUE</span><span>${fmtPeso(adjustedTotal)}</span></div></div>
    <p class="receipt-paper-words">Amount in Words: <strong>${safe(numberToWords(adjustedTotal))}</strong></p>
    <div class="receipt-paper-payments"><div><span>Payment Received</span><span>${fmtPeso(totalPaid)}</span></div><div><span>Outstanding Balance</span><span>${fmtPeso(balance)}</span></div><div><span>Mode of Payment</span><span>${methods}</span></div></div>
    ${(inv as any).notes ? `<p class="receipt-paper-words"><strong>Notes:</strong> ${safe((inv as any).notes)}</p>` : ''}
    <div class="receipt-paper-footer">Thank you for your purchase!</div>`;
}
