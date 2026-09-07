import { test, expect } from '@playwright/test';

const adminUser = process.env.QA_ADMIN_USER || 'admin';
const adminPin = process.env.QA_ADMIN_PIN || '0000';
const marker = `QA-RETURN-${Date.now()}`;
const staffUser = marker.toLowerCase();
const initialStaffPin = '1357';
const staffPin = '2468';

test.beforeEach(async ({ page }) => {
  const browserUrl = process.env.QA_BROWSER_URL || 'https://buildpro-pos.vercel.app';
  const host = new URL(browserUrl).hostname;
  const productionHosts = ['buildpro-pos.vercel.app', 'jegpos.vercel.app'];
  if (process.env.QA_ALLOW_MUTATION !== 'true' || (productionHosts.includes(host) && process.env.QA_ALLOW_PRODUCTION !== 'true')) {
    throw new Error('Refusing to mutate data. Set QA_ALLOW_MUTATION=true; production also requires QA_ALLOW_PRODUCTION=true.');
  }
  await page.goto('/');
  await expect(page.locator('#login-btn')).toBeVisible();
});

async function login(page, username, pin) {
  await page.locator('#login-user').fill(username);
  await page.locator('#login-pin').fill(pin);
  await page.locator('#login-btn').click();
  await expect(page.locator('#login-btn')).toBeHidden();
  await expect(page.locator('#header-user')).toBeVisible();
  await expect(page.locator('[data-view="invoices"]').first()).toBeVisible();
}

async function logout(page) {
  await page.locator('.logout-btn').click();
  await expect(page.locator('#login-btn')).toBeVisible();
}

test('staff sale -> admin return -> updated receipt, recorded as a video', async ({ page, request }) => {
  test.info().annotations.push({ type: 'qa-record', description: marker });

  // Seed one clearly labelled product through the API; the browser video covers the operational workflow.
  const adminLogin = await request.post('/api/auth/login', { data: { username: adminUser, pin: adminPin } });
  expect(adminLogin.ok()).toBeTruthy();
  const adminToken = (await adminLogin.json()).token;
  const materialResponse = await request.post('/api/materials', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { name: `${marker} Product`, unit: 'Piece', stock: 10, cost_price: 10, price_per_unit: 20, reorder_point: 1, category: 'Other', barcode: `${marker}-BARCODE` },
  });
  expect(materialResponse.status()).toBe(201);
  const material = await materialResponse.json();

  await login(page, adminUser, adminPin);

  // Admin creates the staff account and sets the PIN in the real Settings UI.
  await page.evaluate(() => window.loadView('settings'));
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Staff', exact: true }).click();
  await page.getByRole('button', { name: '+ Add Staff', exact: true }).click();
  await page.locator('#uf-user').fill(staffUser);
  await page.locator('#uf-pin').fill(initialStaffPin);
  await page.locator('#uf-role').selectOption('staff');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(staffUser, { exact: true })).toBeVisible();

  // Admin changes the newly created staff PIN before opening the shift.
  const staffRow = page.locator('tbody tr').filter({ hasText: staffUser });
  await staffRow.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#uf-pin').fill(staffPin);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(staffUser, { exact: true })).toBeVisible();

  // Admin opens the staff shift with opening cash.
  await page.getByRole('button', { name: 'Cashier Shift', exact: true }).click();
  await page.locator('#shift-staff').selectOption({ label: staffUser });
  await page.locator('#shift-opening').fill('100');
  await page.getByRole('button', { name: 'Open Staff Shift', exact: true }).click();
  await expect(page.getByText('Staff shift opened', { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`Active Staff Shifts`))).toBeVisible();

  await logout(page);

  // Staff logs in and creates a two-unit cash sale.
  await login(page, staffUser, staffPin);
  await page.evaluate(() => window.loadView('invoices'));
  await page.locator('#pos-search').fill(material.name);
  await page.locator('.pos-product').first().click();
  const quantityInput = page.locator('.pos-qty-input').first();
  await quantityInput.waitFor({ state: 'visible' });
  await quantityInput.fill('2');
  await page.locator('#pos-received').click();
  await page.locator('#pos-received').fill('40');
  await page.locator('#pos-method').selectOption('cash');
  await page.getByRole('button', { name: 'Complete Sale', exact: true }).click();
  await expect(page.getByText('Receipt Preview', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await logout(page);

  // Admin returns one unit and inspects the updated receipt.
  await login(page, adminUser, adminPin);
  await page.evaluate(() => window.loadView('invoices'));
  await page.locator('.pos-history').locator('button', { hasText: 'View' }).first().click();
  await expect(page.getByText('Return Items', { exact: true })).toBeVisible();
  const returnInput = page.locator('input[id^="ret-qty-"]').first();
  await returnInput.fill('1');
  await page.getByRole('button', { name: 'Process Returns', exact: true }).click();
  await page.locator('#confirm-yes').click();
  await expect(page.getByText('Return processed', { exact: true })).toBeVisible();
  await expect(page.getByText('Money not refunded yet.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.locator('.pos-history').locator('button', { hasText: 'View' }).first().click();
  await expect(page.getByText('Returned: 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Remaining: 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Print Receipt', exact: true }).click();
  await expect(page.getByText('RECEIPT', { exact: true })).toBeVisible();
  await expect(page.getByText('Returns', { exact: true })).toBeVisible();
  await expect(page.getByText('₱20.00', { exact: true }).first()).toBeVisible();
});
