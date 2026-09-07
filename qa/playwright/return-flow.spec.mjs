import { test, expect } from '@playwright/test';

const adminUser = process.env.QA_ADMIN_USER || 'admin';
const adminPin = process.env.QA_ADMIN_PIN || '0000';
const marker = `QA-RETURN-${Date.now()}`;
const staffUser = 'qa-return-e2e-cashier';
const initialStaffPin = '1357';
const staffPin = '2468';
let stepNumber = 0;

async function showStep(page, title, detail) {
  stepNumber += 1;
  await page.evaluate(({ number, title, detail }) => {
    let caption = document.getElementById('qa-video-caption');
    if (!caption) {
      caption = document.createElement('div');
      caption.id = 'qa-video-caption';
      caption.innerHTML = '<div class="qa-video-caption-step"></div><div class="qa-video-caption-title"></div><div class="qa-video-caption-detail"></div>';
      Object.assign(caption.style, {
        position: 'fixed', top: '18px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647',
        width: 'min(760px, calc(100vw - 48px))', padding: '14px 20px', borderRadius: '12px',
        background: 'rgba(4, 18, 35, .96)', color: '#fff', border: '2px solid #f7931e',
        boxShadow: '0 8px 30px rgba(0,0,0,.35)', fontFamily: 'Arial, sans-serif', textAlign: 'center',
      });
      document.body.appendChild(caption);
    }
    caption.querySelector('.qa-video-caption-step').textContent = `STEP ${number}`;
    caption.querySelector('.qa-video-caption-title').textContent = title;
    caption.querySelector('.qa-video-caption-detail').textContent = detail;
    caption.querySelector('.qa-video-caption-step').style.cssText = 'color:#f7931e;font-size:12px;font-weight:800;letter-spacing:1.5px';
    caption.querySelector('.qa-video-caption-title').style.cssText = 'font-size:20px;font-weight:800;margin-top:3px';
    caption.querySelector('.qa-video-caption-detail').style.cssText = 'color:#c6d5e6;font-size:14px;margin-top:4px';
  }, { number: stepNumber, title, detail });
  await page.waitForTimeout(1800);
}

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
  await page.waitForTimeout(1200);
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
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  // Reuse the same QA staff account between runs. Close only its prior QA shift
  // so reruns do not create duplicate staff or leave multiple open test shifts.
  const usersResponse = await request.get('/api/users', { headers: adminHeaders });
  expect(usersResponse.ok()).toBeTruthy();
  const users = await usersResponse.json();
  const existingStaff = users.find((user) => user.username === staffUser);
  if (existingStaff) {
    const activeShiftsResponse = await request.get('/api/shifts/active', { headers: adminHeaders });
    expect(activeShiftsResponse.ok()).toBeTruthy();
    const activeShifts = await activeShiftsResponse.json();
    const existingShift = activeShifts.find((shift) => shift.user_id === existingStaff.id);
    if (existingShift) {
      const closeResponse = await request.post(`/api/shifts/${existingShift.id}/close`, {
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        data: { closing_cash: Number(existingShift.expected_cash || existingShift.opening_cash || 0), notes: 'Automated QA cleanup before rerun' },
      });
      expect(closeResponse.ok()).toBeTruthy();
    }
  }

  const materialResponse = await request.post('/api/materials', {
    headers: adminHeaders,
    data: { name: `${marker} Product`, unit: 'Piece', stock: 10, cost_price: 10, price_per_unit: 20, reorder_point: 1, category: 'Other', barcode: `${marker}-BARCODE` },
  });
  expect(materialResponse.status()).toBe(201);
  const material = await materialResponse.json();

  await showStep(page, 'Admin signs in', 'Log in as Administrator to prepare the cashier account.');
  await login(page, adminUser, adminPin);

  // Admin creates the staff account and sets the PIN in the real Settings UI.
  await showStep(page, 'Open Staff settings', 'Go to Settings, then open the Staff management tab.');
  await page.evaluate(() => window.loadView('settings'));
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Staff', exact: true }).click();
  await page.waitForTimeout(1200);
  if (!existingStaff) {
    await showStep(page, 'Create the cashier account', 'Create the reusable QA cashier account with a temporary PIN.');
    await page.getByRole('button', { name: '+ Add Staff', exact: true }).click();
    await page.locator('#uf-user').fill(staffUser);
    await page.locator('#uf-pin').fill(initialStaffPin);
    await page.locator('#uf-role').selectOption('staff');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await expect(page.getByText(staffUser, { exact: true })).toBeVisible();

  // Admin changes the newly created staff PIN before opening the shift.
  await showStep(page, 'Set the cashier PIN', 'Edit the cashier account and save the working PIN.');
  const staffRow = page.locator('tbody tr').filter({ hasText: staffUser });
  await staffRow.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#uf-pin').fill(staffPin);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(staffUser, { exact: true })).toBeVisible();

  // Admin opens the staff shift with opening cash.
  await showStep(page, 'Open the cashier shift', 'Admin selects the cashier and opens the drawer with ₱100.');
  await page.getByRole('button', { name: 'Cashier Shift', exact: true }).click();
  await page.locator('#shift-staff').selectOption({ label: staffUser });
  await page.locator('#shift-opening').fill('100');
  await page.getByRole('button', { name: 'Open Staff Shift', exact: true }).click();
  await expect(page.getByText('Staff shift opened', { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`Active Staff Shifts`))).toBeVisible();

  await logout(page);

  // Staff logs in and creates a two-unit cash sale.
  await showStep(page, 'Cashier signs in', 'The staff member can now access the POS because the shift is open.');
  await login(page, staffUser, staffPin);
  await page.evaluate(() => window.loadView('invoices'));
  await showStep(page, 'Add two products', 'Search for the QA product, add it, and set the quantity to 2.');
  await page.locator('#pos-search').fill(material.name);
  await page.locator('.pos-product').first().click();
  const quantityInput = page.locator('.pos-qty-input').first();
  await quantityInput.waitFor({ state: 'visible' });
  await quantityInput.fill('2');
  await page.locator('#pos-received').click();
  await page.locator('#pos-received').fill('40');
  await page.locator('#pos-method').selectOption('cash');
  await showStep(page, 'Complete the cash sale', 'Enter ₱40 received, then click Complete Sale.');
  await page.getByRole('button', { name: 'Complete Sale', exact: true }).click();
  await expect(page.getByText('Receipt Preview', { exact: true })).toBeVisible();
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await logout(page);

  // Admin returns one unit and inspects the updated receipt.
  await showStep(page, 'Open the invoice as Admin', 'Admin returns to Sales History and opens the completed sale.');
  await login(page, adminUser, adminPin);
  await page.evaluate(() => window.loadView('invoices'));
  const salesHistory = page.locator('.pos-history');
  if (!(await salesHistory.evaluate((element) => element.open))) {
    await salesHistory.locator('summary').click();
  }
  await salesHistory.locator('button', { hasText: 'View' }).first().click();
  await expect(page.getByText('Return Items', { exact: true })).toBeVisible();
  await showStep(page, 'Process one returned item', 'Enter quantity 1 and confirm the return. Stock and invoice totals update.');
  const returnInput = page.locator('input[id^="ret-qty-"]').first();
  await returnInput.fill('1');
  await page.getByRole('button', { name: 'Process Returns', exact: true }).click();
  await page.locator('#confirm-yes').click();
  await expect(page.getByText('Return processed', { exact: true })).toBeVisible();
  await expect(page.getByText('Money not refunded yet.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await showStep(page, 'View the updated receipt', 'Open the invoice again to verify Returned 1, Remaining 1, and the receipt adjustment.');
  if (!(await salesHistory.evaluate((element) => element.open))) {
    await salesHistory.locator('summary').click();
  }
  await salesHistory.locator('button', { hasText: 'View' }).first().click();
  const invoiceDetail = page.locator('#invoice-detail-modal');
  await expect(invoiceDetail).toContainText('Returned:');
  await expect(invoiceDetail).toContainText('Remaining:');
  await expect(invoiceDetail).toContainText('Remaining: 1');
  await page.getByRole('button', { name: 'Print Receipt', exact: true }).click();
  const receiptPreview = page.locator('#receipt-preview-modal');
  await expect(receiptPreview).toContainText('RECEIPT');
  await expect(receiptPreview).toContainText('Returns');
  await expect(receiptPreview).toContainText('₱20.00');
});
