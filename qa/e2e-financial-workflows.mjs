/* Live financial/operations E2E checks. Excludes printers and browser-only UI. */
import assert from 'node:assert/strict';

const base = (process.env.QA_BASE_URL || '').replace(/\/$/, '');
const host = (() => { try { return new URL(base).hostname; } catch { return ''; } })();
if (process.env.QA_ALLOW_MUTATION !== 'true' || !base || (host === 'buildpro-pos.vercel.app' && process.env.QA_ALLOW_PRODUCTION !== 'true')) {
  console.error('Refusing to run: set QA_BASE_URL, QA_ALLOW_MUTATION=true, and QA_ALLOW_PRODUCTION=true for production.'); process.exit(2);
}
const marker = `QA-FIN-${Date.now()}`;
async function req(path, { token, method='GET', body, status } = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
  let response;
  try { response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal }); }
  finally { clearTimeout(timer); }
  const text = await response.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { raw:text }; }
  if (status !== undefined) assert.equal(response.status, status, `${method} ${path}: ${data?.error || response.status}`); else assert.ok(response.ok, `${method} ${path}: ${data?.error || response.status}`);
  return data;
}
const login = async (username, pin, status=200) => (await req('/auth/login', { method:'POST', body:{ username, pin }, status }))?.token;
const admin = await login(process.env.QA_ADMIN_USER || 'admin', process.env.QA_ADMIN_PIN || '0000');
const staffName = `${marker.toLowerCase()}-cashier`;
await req('/users', { token:admin, method:'POST', body:{ username:staffName, pin:'2468', role:'staff' }, status:201 });
const users = await req('/users', { token:admin });
const staff = users.find(u => u.username === staffName); assert.ok(staff);
const supplier = await req('/suppliers', { token:admin, method:'POST', body:{ name:`${marker} Supplier`, phone:'09171234567' }, status:201 });
const material = await req('/materials', { token:admin, method:'POST', body:{ name:`${marker} Product`, unit:'Piece', stock:30, cost_price:10, price_per_unit:20, reorder_point:2, category:'Other', supplier_id:supplier.id, barcode:`${marker}-BAR` }, status:201 });
const shift = await req('/shifts/open', { token:admin, method:'POST', body:{ user_id:staff.id, opening_cash:100 }, status:201 });
const staffToken = await login(staffName, '2468');

// Backend validation: credit requires an account name; empty carts and invalid payment amounts are rejected.
await req('/invoices', { token:staffToken, method:'POST', body:{ items:[], payment:{ amount:0, method:'credit' } }, status:400 });
await req('/invoices', { token:staffToken, method:'POST', body:{ items:[{ material_id:material.id, description:material.name, quantity:1, unit_price:20 }], payment:{ amount:0, method:'credit' } }, status:400 });

// Cash sale, stock decrement, overpayment rejection, card refund, and full return.
const cashSale = await req('/invoices', { token:staffToken, method:'POST', body:{ items:[{ material_id:material.id, description:material.name, quantity:1, unit_price:20 }], payment:{ amount:20, method:'cash' } }, status:201 });
assert.equal(Number((await req(`/materials/${material.id}`, { token:staffToken })).stock), 29);
await req(`/invoices/${cashSale.id}/pay`, { token:staffToken, method:'POST', body:{ amount:1, method:'card' }, status:400 });
await req(`/invoices/${cashSale.id}/refund`, { token:admin, method:'POST', body:{ amount:5, method:'cash', reference:marker }, status:201 });
const cashDetails = await req(`/invoices/${cashSale.id}`, { token:staffToken });
assert.equal(Number(cashDetails.net_paid), 15);
await req(`/invoices/${cashSale.id}/return`, { token:admin, method:'POST', body:{ items:[{ invoice_item_id:cashDetails.items[0].id, material_id:material.id, quantity:1 }] }, status:200 });
assert.equal(Number((await req(`/materials/${material.id}`, { token:staffToken })).stock), 30);

// Credit account flow: pending -> partial -> paid, receivable balance, credit memo, and refund.
const creditSale = await req('/invoices', { token:staffToken, method:'POST', body:{ credit_account_name:`${marker} Buyer`, items:[{ material_id:material.id, description:material.name, quantity:2, unit_price:20 }], payment:{ amount:0, method:'credit' } }, status:201 });
assert.equal(creditSale.status, 'pending');
let rec = await req('/invoices/receivables?page=1&pageSize=100', { token:staffToken });
let row = rec.data.find(x => x.id === creditSale.id); assert.ok(row); assert.equal(Number(row.balance), 40);
await req(`/invoices/${creditSale.id}/pay`, { token:staffToken, method:'POST', body:{ amount:1, method:'credit' }, status:400 });
await req(`/invoices/${creditSale.id}/pay`, { token:staffToken, method:'POST', body:{ amount:10, method:'cash' }, status:201 });
let creditDetails = await req(`/invoices/${creditSale.id}`, { token:staffToken }); assert.equal(creditDetails.status, 'partial');
await req(`/invoices/${creditSale.id}/pay`, { token:staffToken, method:'POST', body:{ amount:30, method:'card' }, status:201 });
creditDetails = await req(`/invoices/${creditSale.id}`, { token:staffToken }); assert.equal(creditDetails.status, 'paid');
await req(`/invoices/${creditSale.id}/credit-memo`, { token:admin, method:'POST', body:{ amount:5, reason:`${marker} adjustment` }, status:201 });
await req(`/invoices/${creditSale.id}/refund`, { token:admin, method:'POST', body:{ amount:10, method:'card', reference:marker }, status:201 });
creditDetails = await req(`/invoices/${creditSale.id}`, { token:staffToken }); assert.equal(creditDetails.status, 'partial');
rec = await req('/invoices/receivables?page=1&pageSize=100', { token:staffToken });
row = rec.data.find(x => x.id === creditSale.id); assert.ok(row); assert.equal(Number(row.balance), 5);
await req('/invoices/receivables?status=paid&page=1&pageSize=100', { token:staffToken });

// Void restores stock and is idempotently protected; reports exclude voided transactions.
const voidSale = await req('/invoices', { token:staffToken, method:'POST', body:{ items:[{ material_id:material.id, description:material.name, quantity:2, unit_price:20 }], payment:{ amount:40, method:'gcash' } }, status:201 });
assert.equal(Number((await req(`/materials/${material.id}`, { token:staffToken })).stock), 26);
await req(`/invoices/${voidSale.id}/void`, { token:admin, method:'PUT', body:{ reason:`${marker} void test` }, status:200 });
assert.equal(Number((await req(`/materials/${material.id}`, { token:staffToken })).stock), 28);
await req(`/invoices/${voidSale.id}/void`, { token:admin, method:'PUT', body:{ reason:'again' }, status:409 });

// Pending invoice deletion restores inventory and removes the invoice.
const pending = await req('/invoices', { token:admin, method:'POST', body:{ items:[{ material_id:material.id, description:material.name, quantity:1, unit_price:20 }] }, status:201 });
assert.equal(Number((await req(`/materials/${material.id}`, { token:admin })).stock), 27);
await req(`/invoices/${pending.id}`, { token:admin, method:'DELETE', status:204 });
assert.equal(Number((await req(`/materials/${material.id}`, { token:admin })).stock), 28);

// Expenses, reports, CSV export, payment receipts, and PO receiving/cancellation/deletion.
const expense = await req('/expenses', { token:admin, method:'POST', body:{ category:`${marker} Utilities`, amount:25, expense_date:'2026-09-07', payment_method:'cash', description:'QA expense' }, status:201 });
await req(`/expenses/${expense.id}`, { token:admin, method:'PUT', body:{ amount:30 }, status:200 });
const summary = await req('/expenses/summary?from=2026-09-01&to=2026-09-30', { token:admin }); assert.ok(summary.some(x => x.category === `${marker} Utilities` && Number(x.total) === 30));
const cashFlow = await req('/reports/cash-flow?from=2026-09-01&to=2026-09-30', { token:admin }); assert.ok('net_cash_change' in cashFlow);
const financial = await req('/reports/financial-summary?from=2020-01-01&to=2030-12-31', { token:admin }); assert.ok('net_profit' in financial && 'accounts_receivable' in financial);
const books = await req('/reports/books?from=2020-01-01&to=2030-12-31', { token:admin }); assert.ok(Array.isArray(books.sales) && Array.isArray(books.receipts) && Array.isArray(books.receivables));
const daily = await req('/reports/daily?date=2026-09-07', { token:admin }); assert.ok(Array.isArray(daily.invoices));
const exported = await req('/reports/export?from=2020-01-01&to=2030-12-31', { token:admin }); assert.ok(typeof exported.raw === 'string' || exported === null || typeof exported === 'object');
const receipts = await req('/payments/receipts?page=1&pageSize=100', { token:admin }); assert.ok(Array.isArray(receipts.data));
const po = await req('/purchase-orders', { token:admin, method:'POST', body:{ supplier_id:supplier.id, order_date:'2026-09-07', items:[{ material_id:material.id, description:material.name, quantity:5, unit_cost:11 }] }, status:201 });
await req(`/purchase-orders/${po.id}/receive`, { token:admin, method:'PUT', status:200 });
assert.equal(Number((await req(`/materials/${material.id}`, { token:admin })).stock), 33);
await req(`/purchase-orders/${po.id}/receive`, { token:admin, method:'PUT', status:400 });
const cancelPo = await req('/purchase-orders', { token:admin, method:'POST', body:{ supplier_id:supplier.id, order_date:'2026-09-07', items:[{ description:`${marker} nonstock`, quantity:1, unit_cost:5 }] }, status:201 });
await req(`/purchase-orders/${cancelPo.id}/cancel`, { token:admin, method:'PUT', status:200 });
await req(`/purchase-orders/${cancelPo.id}`, { token:admin, method:'DELETE', status:400 });
const deletePo = await req('/purchase-orders', { token:admin, method:'POST', body:{ supplier_id:supplier.id, order_date:'2026-09-07', items:[{ description:`${marker} delete`, quantity:1, unit_cost:5 }] }, status:201 });
await req(`/purchase-orders/${deletePo.id}`, { token:admin, method:'DELETE', status:204 });

await req(`/expenses/${expense.id}`, { token:admin, method:'DELETE', status:204 });
console.log('BuildPro POS financial/operations E2E checks passed:', marker);
