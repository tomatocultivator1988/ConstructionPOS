import { loadView } from './lib/router';
import { closeModal, isAdmin } from './lib/helpers';
import { isLoggedIn, apiGet, getCurrentUser } from './lib/api';
import * as materials from './views/materials';
import * as invoices from './views/invoices';
import * as expenses from './views/expenses';
import * as suppliers from './views/suppliers';
import * as purchaseOrders from './views/purchase-orders';
import * as reports from './views/reports';
import * as login from './views/login';
import * as settings from './views/settings';
import { printReceipt, showReceiptPreview, printShift } from './views/receipt';
import * as receipts from './views/receipts';
import * as productMix from './views/product-mix';
import * as receivables from './views/receivables';
import { openHelp } from './lib/help';
import { submitExportPeriod, toggleExportCustomRange } from './lib/export';

Object.assign(window, {
  loadView,
  closeModal,
  logout: login.logout,
  doLogin: login.doLogin,
  showMaterialModal: materials.showMaterialModal,
  toggleCustomUnit: materials.toggleCustomUnit,
  addProductCatalogOption: materials.addProductCatalogOption,
  saveProductCatalogOption: materials.saveProductCatalogOption,
  createMaterial: materials.createMaterial,
  updateMaterial: materials.updateMaterial,
  editMaterial: materials.editMaterial,
  delMaterial: materials.delMaterial,
  filterMaterials: materials.filterMaterials,
  showStockHistory: materials.showStockHistory,
  changeMaterialPage: materials.changeMaterialPage,
  applyProductMixFilter: productMix.applyProductMixFilter,
  clearProductMixFilter: productMix.clearProductMixFilter,
  filterReceivables: receivables.filterReceivables,
  changeReceivablePage: receivables.changeReceivablePage,
  drawReceivablesTrend: receivables.drawReceivablesTrend,
  showReceivableNameModal: receivables.showReceivableNameModal,
  saveReceivableName: receivables.saveReceivableName,
  exportReceivables: receivables.exportReceivables,
  toggleMobileDetails: materials.toggleMobileDetails,
  showInvoiceDetail: invoices.showInvoiceDetail,
  recordPayment: invoices.recordPayment,
  delInvoice: invoices.delInvoice,
  showDeliveryModal: invoices.showDeliveryModal,
  saveDeliveryPerson: invoices.saveDeliveryPerson,
  changeInvoicePage: invoices.changeInvoicePage,
  setPOSCategory: invoices.setPOSCategory,
  filterPOSMaterials: invoices.filterPOSMaterials,
  addPOSItem: invoices.addPOSItem,
  changePOSQty: invoices.changePOSQty,
  removePOSItem: invoices.removePOSItem,
  clearPOSCart: invoices.clearPOSCart,
  togglePOSCart: invoices.togglePOSCart,
  updatePOSPayment: invoices.updatePOSPayment,
  completePOSSale: invoices.completePOSSale,
  exportSalesHistory: invoices.exportSalesHistory,
  enhancePOS: invoices.enhancePOS,
  startPOSCameraScan: invoices.startPOSCameraScan,
  stopPOSCameraScan: invoices.stopPOSCameraScan,
  startMaterialBarcodeCamera: materials.startMaterialBarcodeCamera,
  scanPOSBarcode: invoices.scanPOSBarcode,
  setPOSQty: invoices.setPOSQty,
  returnItems: invoices.returnItems,
  voidInvoice: invoices.voidInvoice,
  submitVoidInvoice: invoices.submitVoidInvoice,
  issueCreditMemo: invoices.issueCreditMemo,
  submitCreditMemo: invoices.submitCreditMemo,
  recordRefund: invoices.recordRefund,
  submitRefund: invoices.submitRefund,
  filterReceipts: receipts.filterReceipts,
  changeReceiptPage: receipts.changeReceiptPage,
  viewReceipt: receipts.viewReceipt,
  showExpenseModal: expenses.showExpenseModal,
  exportExpenses: expenses.exportExpenses,
  createExpense: expenses.createExpense,
  updateExpense: expenses.updateExpense,
  editExpense: expenses.editExpense,
  delExpense: expenses.delExpense,
  addExpenseCategory: expenses.addExpenseCategory,
  saveExpenseCategory: expenses.saveExpenseCategory,
  showSupplierModal: suppliers.showSupplierModal,
  exportSuppliers: suppliers.exportSuppliers,
  createSupplier: suppliers.createSupplier,
  updateSupplier: suppliers.updateSupplier,
  editSupplier: suppliers.editSupplier,
  delSupplier: suppliers.delSupplier,
  showPOModal: purchaseOrders.showPOModal,
  addPOLineItem: purchaseOrders.addPOLineItem,
  poMaterialChanged: purchaseOrders.poMaterialChanged,
  removePOLineItem: purchaseOrders.removePOLineItem,
  createPO: purchaseOrders.createPO,
  showPODetail: purchaseOrders.showPODetail,
  receivePO: purchaseOrders.receivePO,
  cancelPO: purchaseOrders.cancelPO,
  delPO: purchaseOrders.delPO,
  switchSupplierTab: suppliers.switchSupplierTab,
  switchReportTab: reports.switchReportTab,
  reloadDaily: reports.reloadDaily,
  reloadMonthly: reports.reloadMonthly,
  reloadTax: reports.reloadTax,
  loadRangeReport: reports.loadRangeReport,
  printReport: reports.printReport,
  applyReportPeriod: reports.applyReportPeriod,
  exportReports: reports.exportReports,
  reloadBooks: reports.reloadBooks,
  reloadFinancialSummary: reports.reloadFinancialSummary,
  switchSettingsTab: settings.switchSettingsTab,
  selectAttendanceStaff: settings.selectAttendanceStaff,
  changeAttendanceMonth: settings.changeAttendanceMonth,
  setAttendanceStatus: settings.setAttendanceStatus,
  showAttendanceRemarkModal: settings.showAttendanceRemarkModal,
  saveAttendanceRemark: settings.saveAttendanceRemark,
  saveSettings: settings.saveSettings,
  updateShiftVariance: settings.updateShiftVariance,
  showShiftPreview: settings.showShiftPreview,
  openCashierShift: settings.openCashierShift,
  closeCashierShift: settings.closeCashierShift,
  showCloseStaffShift: settings.showCloseStaffShift,
  closeStaffShift: settings.closeStaffShift,
  recordCashEvent: settings.recordCashEvent,
  showCashEventModal: settings.showCashEventModal,
  submitCashEvent: settings.submitCashEvent,
  showUserModal: settings.showUserModal,
  createUser: settings.createUser,
  updateUser: settings.updateUser,
  delUser: settings.delUser,
  printReceipt,
  printShift,
  showReceiptPreview,
  checkLowStock: () => checkLowStock(),
  openMobileMore,
  openHelp,
  submitExportPeriod,
  toggleExportCustomRange,
});

// Keep the primary navigation in the same workflow order on desktop.
const desktopNavOrder = ['dashboard', 'invoices', 'materials', 'product-mix', 'receipts', 'expenses', 'suppliers', 'reports', 'receivables', 'settings'];
const desktopNav = document.getElementById('desktop-nav');
if (desktopNav) desktopNavOrder.forEach(view => { const button = desktopNav.querySelector(`[data-view="${view}"]`); if (button) desktopNav.appendChild(button); });

// Navigation — desktop
document.querySelectorAll('#desktop-nav .nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = (btn as HTMLElement).dataset.view!;
    if (view !== '__more') loadView(view);
    if ((btn as HTMLElement).dataset.view === 'dashboard') checkLowStock();
  });
});

// Navigation — bottom nav
document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = (btn as HTMLElement).dataset.view!;
    if (view !== '__more') loadView(view);
    if ((btn as HTMLElement).dataset.view === 'dashboard') checkLowStock();
  });
});

// Online/offline detection
function updateOnlineStatus() {
  document.body.classList.toggle('offline', !navigator.onLine);
}

document.getElementById('help-button')?.addEventListener('click', openHelp);
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// PWA install prompt
let deferredPrompt: any;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  document.body.classList.add('show-install');
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  document.body.classList.remove('show-install');
});
document.getElementById('install-btn')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const result = await deferredPrompt.userChoice;
  if (result.outcome === 'accepted') {
    deferredPrompt = null;
    document.body.classList.remove('show-install');
  }
});
document.getElementById('install-dismiss')?.addEventListener('click', () => {
  deferredPrompt = null;
  document.body.classList.remove('show-install');
});

// Service worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

export function applyRoleUI() {
  const admin = isAdmin();
  document.body.classList.toggle('staff-user', !admin);
  const staffBlockedTabs = ['dashboard', 'materials', 'product-mix', 'receipts', 'expenses', 'suppliers', 'reports', 'receivables', 'settings', '__more'];
  staffBlockedTabs.forEach(view => {
    const btn = document.querySelector(`[data-view="${view}"]`) as HTMLElement;
    if (btn) btn.style.display = admin ? '' : 'none';
  });
}

function openMobileMore() {
  const options = isAdmin() ? [['product-mix', 'Product Mix'], ['receipts', 'Receipts'], ['receivables', 'Receivables'], ['reports', 'Reports'], ['settings', 'Settings']] : [];
  const modal = document.createElement('div');
  modal.className = 'modal'; modal.id = 'mobile-more-modal';
  modal.innerHTML = `<div class="modal-content"><h3>More</h3><div class="mobile-more-menu">${options.map(([view, label]) => `<button class="btn mobile-more-option" onclick="closeModal();loadView('${view}')">${label}<span>›</span></button>`).join('')}</div><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div></div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// Init
if (isLoggedIn()) {
  applyRoleUI();
  loadView('dashboard');
  checkLowStock();
  showUserHeader();
} else {
  login.showLogin();
}

function showUserHeader() {
  const user = getCurrentUser();
  if (!user) return;
  const el = document.getElementById('header-user');
  const nameEl = document.getElementById('user-name-display');
  if (el) el.style.display = 'flex';
  if (nameEl) nameEl.textContent = user.username + (user.role === 'admin' ? ' (admin)' : '');
}

async function checkLowStock() {
  try {
    const result = await apiGet<any>('/materials?lowStock=1&page=1&pageSize=1');
    const lowCount = Array.isArray(result) ? result.length : Number(result.total || 0);
    const badge = document.querySelector('[data-view="materials"]');
    if (badge) {
      const existing = badge.querySelector('.nav-badge');
      if (existing) existing.remove();
      if (lowCount > 0) {
        const b = document.createElement('span');
        b.className = 'nav-badge';
        b.textContent = String(lowCount);
        badge.appendChild(b);
        // showToast is used here but was never imported in original — leaving as-is
      }
    }
  } catch {}
}
