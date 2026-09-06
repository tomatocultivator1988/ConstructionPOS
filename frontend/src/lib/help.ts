import { getCurrentView } from './router';

type HelpSection = {
  title: string;
  body: string;
};

const GUIDE: Record<string, { title: string; intro: string; sections: HelpSection[] }> = {
  dashboard: {
    title: 'Dashboard',
    intro: 'Use the dashboard for a quick view of sales, collections, stock, margins, and activity that needs attention.',
    sections: [
      { title: 'What the cards mean', body: '<strong>Today\'s Collections</strong> is money recorded through payments today. <strong>Today\'s Profit</strong> is the system\'s estimated gross profit. <strong>Outstanding</strong> is unpaid or partially paid invoice balance. <strong>Low Stock Items</strong> are at or below their reorder point. Stock Value shows cost and retail values.' },
      { title: 'Charts and lists', body: 'Use the sales/profit trend, top materials, margin, invoice status, low-stock, and top-customer sections to spot changes. Click a low-stock card to open Materials.' },
      { title: 'Important', body: 'Dashboard figures depend on the dates and transactions recorded in the system. Use Reports when you need a detailed or printable result.' },
    ],
  },
  customers: {
    title: 'Customers',
    intro: 'Store buyer information so account sales, statements, and purchase history can be connected to the correct customer.',
    sections: [
      { title: 'Add a customer', body: 'Click <strong>+ Add Customer</strong>. Name and address are required. Phone, email, and TIN are optional but should be completed when needed for business documentation. Turn on Wholesale when the customer belongs to that pricing/customer group.' },
      { title: 'Customer actions', body: '<strong>Edit</strong> changes the customer record. <strong>SOA</strong> opens a statement showing invoices, paid amounts, and outstanding balance. <strong>Details</strong> expands the compact mobile row. Delete is restricted and should not be used when the record is needed for transaction history.' },
      { title: 'In a sale', body: 'Choose the registered customer for an account sale. Use the Walk-in option for a sale that does not need a customer account.' },
    ],
  },
  materials: {
    title: 'Materials',
    intro: 'Maintain the items you sell, their measurement units, pricing, stock, and reorder levels.',
    sections: [
      { title: 'Add or edit a material', body: 'Click <strong>+ Add Material</strong> or <strong>Edit</strong>. Enter the item name, category, unit, cost price, selling price, stock, and reorder point. Use the predefined unit list or choose <strong>Custom unit…</strong> and enter the unit used by your store.' },
      { title: 'Stock and pricing', body: 'Cost price supports margin and profit calculations. Selling price is used when the item is added to an invoice. Stock is reduced by completed sales and increased when a purchase order is received. The low-stock indicator appears when stock is at or below the reorder point.' },
      { title: 'History and deletion', body: 'Use <strong>History</strong> to review stock movements. Do not delete an item that is referenced by sales or purchasing records; preserve the history and edit the current item details instead.' },
    ],
  },
  'product-mix': {
    title: 'Product Mix',
    intro: 'See which products are selling and how each product contributes to revenue and gross profit.',
    sections: [
      { title: 'How to read it', body: '<strong>Revenue</strong> is recorded line revenue after returns. <strong>COGS</strong> uses the cost captured on each sale. <strong>Gross Profit</strong> is revenue less COGS. Margin and Share show the product contribution relative to its own revenue and total product revenue.' },
      { title: 'Inventory decisions', body: '<strong>No sales</strong> identifies products with no completed, non-voided sales. The low-stock label is shown alongside it when stock is at or below the product reorder point. Use this page with Products before reordering or changing prices.' },
    ],
  },
  invoices: {
    title: 'Invoices / Sales',
    intro: 'This is BuildPro\'s selling screen. It creates the sale record, deducts stock, and connects the customer, payment, receipt, and reports.',
    sections: [
      { title: 'Create a sale', body: 'Click <strong>+ New Invoice</strong>. Leave the Walk-in Sale option on for a counter sale without a customer account. Turn it off to select a registered customer. Add one or more materials and quantities, then review the total and click <strong>Create Invoice</strong>.' },
      { title: 'Record payment', body: 'Open the invoice with <strong>View</strong>, enter the amount and payment method, then click <strong>Pay</strong>. A full payment marks the invoice paid; a partial payment leaves a balance. The payment is included in Receipts and cash/payment reports.' },
      { title: 'After the sale', body: 'Completed invoice items reduce stock. The invoice balance, customer statement, dashboard, reports, and receipt history are based on the transaction and its payments. Print the receipt from the invoice after recording payment.' },
      { title: 'Corrections', body: '<strong>Return Items</strong> handles returned quantities and stock restoration. <strong>Credit Memo</strong> adjusts the invoice balance. <strong>Refund</strong> records money returned after payment. <strong>Void Invoice</strong> is an admin action for invalid sales and requires a reason. Do not delete issued sales unless the system explicitly allows it for a safe, unused record.' },
    ],
  },
  receivables: {
    title: 'Receivables',
    intro: 'Manage credit sales and see exactly who still has an unpaid balance.',
    sections: [
      { title: 'Credit sales', body: 'Cash, card, bank, GCash, and check sales may remain Walk-in. A Credit / On Account sale requires a <strong>Charge To / Buyer Name</strong>; no customer account or due date is required.' },
      { title: 'Collect payment', body: 'Use Search or the status filter to find unpaid or partially paid sales. Tap <strong>Record Payment</strong>, enter the payment amount and method, then confirm. The balance updates from the invoice payment history.' },
    ],
  },
  receipts: {
    title: 'Receipts',
    intro: 'Find payment receipts from completed or partially paid sales.',
    sections: [
      { title: 'Find a receipt', body: 'Search by receipt/invoice number or customer. Results show 15 records per page; use Previous and Next for more.' },
      { title: 'View or print', body: 'Click <strong>View</strong> to open the related sale details. Click <strong>Print</strong> to open the receipt print layout. If printing does not open, allow pop-ups for this site and confirm the browser has access to the selected printer.' },
      { title: 'Receipt versus invoice', body: 'An invoice is the sale and balance record. A receipt is proof of a payment recorded against that sale. An unpaid invoice should not be treated as a paid receipt.' },
    ],
  },
  expenses: {
    title: 'Expenses',
    intro: 'Record business expenses so cash activity and profit reporting include money spent by the business.',
    sections: [
      { title: 'Add an expense', body: 'Click <strong>+ Add Expense</strong>. Enter the date, category, description, vendor when applicable, payment method, and amount. Use the category that best matches the business expense.' },
      { title: 'Reports', body: 'Expenses appear in expense summaries and profit/loss reporting. The payment method helps distinguish cash and non-cash activity.' },
      { title: 'Correction', body: 'Edit an incorrect entry when appropriate. Deletion is restricted; preserve supporting documents and use the audit history for controlled changes.' },
    ],
  },
  suppliers: {
    title: 'Suppliers',
    intro: 'Keep vendor information available for purchase orders and purchasing records.',
    sections: [
      { title: 'Add a supplier', body: 'Click <strong>+ Add Supplier</strong> and enter the supplier name. Contact person, phone, email, and TIN help identify the vendor and support purchasing documentation.' },
      { title: 'Use with purchasing', body: 'Select the supplier when creating a Purchase Order. Keep supplier details current so the PO and receiving history remain understandable.' },
    ],
  },
  'purchase-orders': {
    title: 'Purchase Orders',
    intro: 'Use purchase orders to document expected supplier purchases and add stock when goods are actually received.',
    sections: [
      { title: 'Create a PO', body: 'Click <strong>+ New PO</strong>, choose a supplier, add materials and quantities, review the cost, and save the PO. A PO records the planned purchase; it does not mean stock has already arrived.' },
      { title: 'Receive stock', body: 'For a pending PO, click <strong>Receive</strong> only when the supplier delivery has arrived and the quantities are verified. Receiving increases material stock and closes the purchasing step.' },
      { title: 'Cancel or delete', body: 'Use <strong>Cancel</strong> for a PO that will not proceed. Administrative deletion should be reserved for an erroneous unused record so stock and purchasing history are not lost.' },
    ],
  },
  reports: {
    title: 'Reports',
    intro: 'Reports turn recorded sales, payments, expenses, inventory, and adjustments into operational and financial views. Start with the report that matches the question you are asking.',
    sections: [
      { title: 'Choose the right report', body: '<strong>Daily Sales</strong>: one day\'s invoices, payment methods, tax, profit, and paid amounts. <strong>P&L</strong>: monthly net sales, cost of goods, gross profit, expenses, and net profit. <strong>Tax Summary</strong>: monthly invoice count, VATable sales, VAT, exempt sales, and tax-rate breakdown. <strong>Date Range</strong>: sales or profit between two dates. <strong>Books</strong>: sales journal, cash receipts, expenses/purchases, accounts receivable, and cash-flow summary. <strong>Financial Summary</strong>: net sales, COGS, gross profit, expenses, tax payable, collections, receivables, and net profit.' },
      { title: 'How to run one', body: '1. Tap the report tab. 2. Select the date, month, or From/To range. 3. Tap <strong>Load</strong> or <strong>Generate</strong>. 4. Read the summary cards first. 5. Review the detailed table below. 6. Use <strong>Print</strong> when you need a paper/PDF copy.' },
      { title: 'How to read the money', body: '<strong>Sales/invoices</strong> show what was recorded as sold. <strong>Collections/payments</strong> show money actually received. An account invoice can increase sales while remaining unpaid. <strong>COGS</strong> is the recorded cost of sold materials. <strong>Net cash change</strong> is cash receipts minus cash refunds and cash expenses.' },
      { title: 'Reconciliation', body: 'Compare Daily Sales payment totals with Receipts, then compare cash payments with the Cashier Shift closing amount. Investigate refunds, credit memos, voids, cash-in, and cash-out when totals do not match. If a number looks wrong, check the transaction date and the original invoice first.' },
    ],
  },
  settings: {
    title: 'Settings',
    intro: 'Configure business details, users, audit records, and cashier operations. Some sections are available only to administrators.',
    sections: [
      { title: 'General', body: 'Enter the business name, address, TIN/RDO details, VAT status, and invoice defaults. Verify these values before printing production documents; incorrect legal details should not be used on official records.' },
      { title: 'Users', body: 'Administrators can add, edit, or remove users and assign roles. Give each staff member an individual login and do not share PINs.' },
      { title: 'Audit Log', body: 'Administrators can review recorded user actions and changes. Use it when investigating edits, deletions, voids, refunds, or other corrections.' },
      { title: 'Cashier Shift', body: 'Open the shift with opening cash. Record cash-in or cash-out with a reason. At closing, count the cash, enter the closing amount and notes, then close the shift and investigate any variance.' },
    ],
  },
};

const fallback = GUIDE.dashboard;

export function openHelp() {
  document.getElementById('buildpro-help-overlay')?.remove();
  const key = getCurrentView();
  const guide = GUIDE[key] || fallback;
  const overlay = document.createElement('div');
  overlay.className = 'help-overlay';
  overlay.id = 'buildpro-help-overlay';
  overlay.innerHTML = `<aside class="help-drawer" role="dialog" aria-modal="true" aria-labelledby="help-title">
    <div class="help-header"><div><div class="help-eyebrow">BuildPro Help</div><h2 id="help-title">${guide.title}</h2></div><button class="help-close" aria-label="Close help">×</button></div>
    <p class="help-intro">${guide.intro}</p>
    <div class="help-sections">${guide.sections.map((section, index) => `<details class="help-section" ${index === 0 ? 'open' : ''}><summary>${section.title}<span>+</span></summary><div>${section.body}</div></details>`).join('')}</div>
    <div class="help-footer"><strong>Need help with another page?</strong><span>Close this guide, open the page, then tap Help again.</span></div>
  </aside>`;
  const close = () => overlay.remove();
  overlay.querySelector('.help-close')?.addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(event) {
    if (event.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
  document.body.appendChild(overlay);
  (overlay.querySelector('.help-close') as HTMLElement)?.focus();
}
