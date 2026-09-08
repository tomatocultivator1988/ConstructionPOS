import { apiGet } from '../lib/api';
import { esc, fmtDate, fmtPeso, businessDate } from '../lib/helpers';
import { getChartInstances } from '../lib/router';
import type { Invoice, Analytics, PaySummary } from '../lib/types';

export async function renderDashboard(): Promise<string> {
  const [invoicePage, paySummary, analytics] = await Promise.all([
    apiGet<{ data: Invoice[]; total: number }>('/invoices?page=1&pageSize=5'),
    apiGet<PaySummary>('/payments/summary'),
    apiGet<Analytics>('/analytics/dashboard'),
  ]);
  const invoices = invoicePage.data || [];

  const now = new Date();
  const today = businessDate();

  const todaySales = Number(analytics.todaySales || 0);
  const last7: { date: string; label: string; total: number; profit: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(d);
    const dayData = (paySummary.daily || []).find((dd: any) => dd.date === ds);
    const profitData = (analytics.profitTrend || []).find((dd: any) => dd.date === ds);
    last7.push({
      date: ds,
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      total: dayData ? dayData.total : 0,
      profit: profitData ? profitData.profit : 0,
    });
  }

  const invoiceSummary = analytics.invoiceSummary || { total: invoicePage.total || 0, paid: 0, partial: 0, pending: 0, outstanding: 0 };
  const outstanding = Number(invoiceSummary.outstanding || 0);
  const lowStockMats = analytics.lowStockItems || [];
  const avgMargin = Number(analytics.averageMargin || 0);
  const pendingCount = Number(invoiceSummary.pending || 0);
  const partialCount = Number(invoiceSummary.partial || 0);
  const paidCount = Number(invoiceSummary.paid || 0);
  const unpaidCount = pendingCount + partialCount;
  const assignedDeliveries = Number(analytics.deliverySummary?.assigned || 0);

  const recentInvoices = invoices.slice(0, 5);

  const sv = analytics.stockValue || { total_cost: 0, total_retail: 0 };
  const topMats = analytics.topMaterials || [];
  const margins = analytics.materialMargins || [];
  const mRev = analytics.monthRevenue || { revenue: 0, profit: 0 };
  const lmRev = analytics.lastMonthRevenue || { revenue: 0, profit: 0 };
  const yRev = analytics.yearRevenue || { revenue: 0, profit: 0 };
  const oRev = analytics.overallRevenue || { revenue: 0, profit: 0 };
  const monthChange = lmRev.revenue > 0 ? ((mRev.revenue - lmRev.revenue) / lmRev.revenue * 100) : 0;

  const revLabels = JSON.stringify(last7.map(d => d.label));
  const revData = JSON.stringify(last7.map(d => d.total));
  const profitData = JSON.stringify(last7.map(d => d.profit));

  const topMatLabels = JSON.stringify(topMats.map((m: any) => m.name.length > 14 ? m.name.slice(0, 12) + '...' : m.name));
  const topMatRevenue = JSON.stringify(topMats.map((m: any) => m.total_revenue));
  const topMatProfit = JSON.stringify(topMats.map((m: any) => m.profit));

  const marginLabels = JSON.stringify(margins.filter((m: any) => m.price_per_unit > 0).map((m: any) => m.name.length > 16 ? m.name.slice(0, 14) + '...' : m.name).reverse());
  const marginData = JSON.stringify(margins.filter((m: any) => m.price_per_unit > 0).map((m: any) => m.margin_pct).reverse());

  const lowNames = JSON.stringify(lowStockMats.map((m: any) => m.name.length > 18 ? m.name.slice(0, 15) + '...' : m.name));
  const lowStockData = JSON.stringify(lowStockMats.map((m: any) => m.stock));
  const lowReorderData = JSON.stringify(lowStockMats.map((m: any) => m.reorder_point));
  const expenseLabels = JSON.stringify((analytics.expenseByCategory || []).map((e: any) => e.category));
  const expenseData = JSON.stringify((analytics.expenseByCategory || []).map((e: any) => e.total));
  const pnlLabels = JSON.stringify((analytics.pnlTrend || []).map((e: any) => e.month));
  const pnlIncome = JSON.stringify((analytics.pnlTrend || []).map((e: any) => e.income));
  const pnlExpenses = JSON.stringify((analytics.pnlTrend || []).map((e: any) => e.expenses));
  const methodLabels = JSON.stringify((analytics.paymentMethodTotals || []).map((e: any) => e.method));
  const methodData = JSON.stringify((analytics.paymentMethodTotals || []).map((e: any) => e.total));

  setTimeout(() => {
    const chartInstances = getChartInstances();

    const ctx1 = (document.getElementById('chart-revenue') as HTMLCanvasElement)?.getContext('2d');
    if (ctx1) {
      const g = ctx1.createLinearGradient(0, 0, 0, 200);
      g.addColorStop(0, 'rgba(240, 180, 41, 0.3)');
      g.addColorStop(1, 'rgba(240, 180, 41, 0)');
      const g2 = ctx1.createLinearGradient(0, 200, 0, 0);
      g2.addColorStop(0, 'rgba(34, 197, 94, 0.25)');
      g2.addColorStop(1, 'rgba(34, 197, 94, 0)');
      chartInstances.push(new (window as any).Chart(ctx1, {
        type: 'bar',
        data: {
          labels: JSON.parse(revLabels),
          datasets: [
            { label: 'Revenue', data: JSON.parse(revData), backgroundColor: g, borderColor: '#f28c28', borderWidth: 2, borderRadius: 4, borderSkipped: false, order: 2 },
            { label: 'Profit', data: JSON.parse(profitData), type: 'line', fill: true, backgroundColor: g2, borderColor: '#22c55e', borderWidth: 2.5, pointBackgroundColor: '#22c55e', pointBorderColor: '#ffffff', pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0.3, order: 1 },
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: { legend: { position: 'top', align: 'end', labels: { color: '#385671', padding: 16, font: { size: 10, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } } },
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(11,41,69,0.10)' }, ticks: { color: '#637d95', font: { size: 10 }, callback: (v: any) => '₱' + v.toFixed(0) } }, x: { grid: { display: false }, ticks: { color: '#637d95', font: { size: 9 } } } }
        }
      }));
    }

    const ctx2 = (document.getElementById('chart-status') as HTMLCanvasElement)?.getContext('2d');
    if (ctx2) {
      chartInstances.push(new (window as any).Chart(ctx2, {
        type: 'doughnut',
        data: { labels: ['Pending', 'Partial', 'Paid'], datasets: [{ data: [pendingCount, partialCount, paidCount], backgroundColor: ['#ef4444', '#f0b429', '#22c55e'], borderColor: '#ffffff', borderWidth: 3, hoverOffset: 8 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { color: '#385671', padding: 16, font: { size: 11 }, usePointStyle: true, pointStyle: 'circle' } } } }
      }));
    }

    const ctx3 = (document.getElementById('chart-topmats') as HTMLCanvasElement)?.getContext('2d');
    if (ctx3 && topMats.length) {
      chartInstances.push(new (window as any).Chart(ctx3, {
        type: 'bar',
        data: { labels: JSON.parse(topMatLabels), datasets: [
          { label: 'Revenue', data: JSON.parse(topMatRevenue), backgroundColor: 'rgba(242, 140, 40, 0.7)', borderColor: '#f28c28', borderWidth: 1, borderRadius: 3 },
          { label: 'Profit', data: JSON.parse(topMatProfit), backgroundColor: 'rgba(34, 197, 94, 0.7)', borderColor: '#22c55e', borderWidth: 1, borderRadius: 3 },
        ]},
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', align: 'end', labels: { color: '#385671', padding: 12, font: { size: 10 }, usePointStyle: true, pointStyle: 'rectRounded' } } }, scales: { x: { beginAtZero: true, grid: { color: 'rgba(11,41,69,0.10)' }, ticks: { color: '#637d95', font: { size: 9 }, callback: (v: any) => '₱' + v.toFixed(0) } }, y: { grid: { display: false }, ticks: { color: '#385671', font: { size: 10 } } } } }
      }));
    }

    const ctx4 = (document.getElementById('chart-margins') as HTMLCanvasElement)?.getContext('2d');
    if (ctx4 && margins.length) {
      const barColors = JSON.parse(marginData).map((v: number) => v >= 40 ? 'rgba(34, 197, 94, 0.7)' : v >= 20 ? 'rgba(240, 180, 41, 0.7)' : 'rgba(239, 68, 68, 0.7)');
      chartInstances.push(new (window as any).Chart(ctx4, {
        type: 'bar',
        data: { labels: JSON.parse(marginLabels), datasets: [{ label: 'Margin %', data: JSON.parse(marginData), backgroundColor: barColors, borderColor: barColors.map((c: string) => c.replace('0.7', '1')), borderWidth: 1, borderRadius: 3 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, max: 100, grid: { color: 'rgba(11,41,69,0.10)' }, ticks: { color: '#637d95', font: { size: 9 }, callback: (v: any) => v + '%' } }, y: { grid: { display: false }, ticks: { color: '#385671', font: { size: 10 } } } } }
      }));
    }

    const ctx5 = (document.getElementById('chart-lowstock') as HTMLCanvasElement)?.getContext('2d');
    if (ctx5 && lowStockMats.length) {
      chartInstances.push(new (window as any).Chart(ctx5, {
        type: 'bar',
        data: { labels: JSON.parse(lowNames), datasets: [
          { label: 'Current Stock', data: JSON.parse(lowStockData), backgroundColor: 'rgba(245, 158, 11, 0.7)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 3 },
          { label: 'Reorder Point', data: JSON.parse(lowReorderData), backgroundColor: 'rgba(239, 68, 68, 0.5)', borderColor: '#ef4444', borderWidth: 1, borderRadius: 3 },
        ]},
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#385671', padding: 16, font: { size: 11 }, usePointStyle: true, pointStyle: 'rectRounded' } } }, scales: { x: { beginAtZero: true, grid: { color: 'rgba(11,41,69,0.10)' }, ticks: { color: '#637d95', font: { size: 10 } } }, y: { grid: { display: false }, ticks: { color: '#385671', font: { size: 10 } } } } }
      }));
    }

    const ctx6 = (document.getElementById('chart-expenses') as HTMLCanvasElement)?.getContext('2d');
    if (ctx6 && (analytics.expenseByCategory || []).length) {
      chartInstances.push(new (window as any).Chart(ctx6, { type: 'doughnut', data: { labels: JSON.parse(expenseLabels), datasets: [{ data: JSON.parse(expenseData), backgroundColor: ['#ef4444','#8b5cf6','#06b6d4','#22c55e','#f0b429','#94a3b8','#ec4899'], borderColor: '#ffffff', borderWidth: 3 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { color: '#385671', font: { size: 10 }, usePointStyle: true } } } } }));
    }
    const ctx7 = (document.getElementById('chart-pnl') as HTMLCanvasElement)?.getContext('2d');
    if (ctx7) {
      chartInstances.push(new (window as any).Chart(ctx7, { type: 'line', data: { labels: JSON.parse(pnlLabels), datasets: [{ label: 'Income', data: JSON.parse(pnlIncome), borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,.12)', fill: true, tension: .3 }, { label: 'Expenses', data: JSON.parse(pnlExpenses), borderColor: '#ef654a', backgroundColor: 'rgba(239,101,74,.08)', fill: true, tension: .3 }] }, options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' }, scales: { y: { beginAtZero: true, ticks: { color: '#637d95', callback: (v: any) => '₱' + v.toFixed(0) }, grid: { color: 'rgba(11,41,69,.10)' } }, x: { ticks: { color: '#637d95' }, grid: { display: false } } }, plugins: { legend: { position: 'bottom', labels: { color: '#385671', usePointStyle: true } } } } }));
    }
    const ctx8 = (document.getElementById('chart-payment-methods') as HTMLCanvasElement)?.getContext('2d');
    if (ctx8 && (analytics.paymentMethodTotals || []).length) {
      chartInstances.push(new (window as any).Chart(ctx8, { type: 'bar', data: { labels: JSON.parse(methodLabels), datasets: [{ label: 'Collected', data: JSON.parse(methodData), backgroundColor: ['#f28c28','#06b6d4','#8b5cf6','#22c55e','#94a3b8'], borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#637d95', callback: (v: any) => '₱' + v.toFixed(0) }, grid: { color: 'rgba(11,41,69,.10)' } }, x: { ticks: { color: '#637d95' }, grid: { display: false } } }, plugins: { legend: { display: false } } } }));
    }
  }, 50);

  return `
    <div class="dashboard-grid dashboard-summary-grid">
      <div class="dashboard-card card-success">
        <div class="card-label">Today's Sales</div>
        <div class="card-value">${fmtPeso(todaySales)}</div>
        <div class="card-sub">${today}</div>
      </div>
      <div class="dashboard-card card-success">
        <div class="card-label">Today's Profit</div>
        <div class="card-value">${fmtPeso(analytics.todayProfit || 0)}</div>
        <div class="card-sub">Estimated gross profit</div>
      </div>
      <div class="dashboard-card card-warning">
        <div class="card-label">Today's Expenses</div>
        <div class="card-value">${fmtPeso(analytics.todayExpenses || 0)}</div>
        <div class="card-sub">Recorded today</div>
      </div>
      <div class="dashboard-card card-info clickable" onclick="document.querySelector('[data-view=invoices]')?.click()">
        <div class="card-label">Delivery Status</div>
        <div class="card-value">${assignedDeliveries}</div>
        <div class="card-sub">Assigned for delivery</div>
      </div>
      <div class="dashboard-card card-danger clickable" onclick="document.querySelector('[data-view=invoices]')?.click()">
        <div class="card-label">Unpaid Invoices</div>
        <div class="card-value">${fmtPeso(outstanding)}</div>
        <div class="card-sub">${unpaidCount} unpaid</div>
      </div>
    </div>

    <div class="period-bar">
      <div class="period-item">
        <span class="period-label">This Month</span>
        <span class="period-value">${fmtPeso(mRev.revenue)}</span>
        <span class="period-sub" style="color:${monthChange >= 0 ? 'var(--c-success)' : 'var(--c-danger)'}">${monthChange >= 0 ? '↑' : '↓'} ${Math.abs(monthChange).toFixed(1)}% vs last mo.</span>
      </div>
      <div class="period-divider"></div>
      <div class="period-item">
        <span class="period-label">This Year</span>
        <span class="period-value">${fmtPeso(yRev.revenue)}</span>
        <span class="period-sub">Profit: ${fmtPeso(yRev.profit)}</span>
      </div>
      <div class="period-divider"></div>
      <div class="period-item">
        <span class="period-label">All Time</span>
        <span class="period-value">${fmtPeso(oRev.revenue)}</span>
        <span class="period-sub">Profit: ${fmtPeso(oRev.profit)}</span>
      </div>
      <div class="period-divider"></div>
      <div class="period-item">
        <span class="period-label">Total Invoices</span>
        <span class="period-value">${invoiceSummary.total}</span>
        <span class="period-sub">${paidCount} paid, ${pendingCount} pending</span>
      </div>
    </div>

    <div class="chart-grid">
      <div class="chart-card">
        <div class="chart-title">Revenue & Profit Trend — Last 7 Days</div>
        <canvas id="chart-revenue" height="200"></canvas>
      </div>
      <div class="chart-card">
        <div class="chart-title">Invoice Status</div>
        <canvas id="chart-status" height="200"></canvas>
      </div>
    </div>

    <div class="chart-grid">
      <div class="chart-card"><div class="chart-title">Expenses by Category</div><canvas id="chart-expenses" height="200"></canvas></div>
      <div class="chart-card"><div class="chart-title">Profit &amp; Loss — Last 6 Months</div><canvas id="chart-pnl" height="200"></canvas></div>
    </div>
    <div class="chart-grid">
      <div class="chart-card"><div class="chart-title">Collections by Payment Method</div><canvas id="chart-payment-methods" height="200"></canvas><div class="card-sub" style="margin-top:8px">Payment-method totals are not bank-account balances.</div></div>
    </div>

    <div class="chart-grid">
      <div class="chart-card">
        <div class="chart-title">Top Selling Materials</div>
        <canvas id="chart-topmats" height="200"></canvas>
      </div>
      <div class="chart-card">
        <div class="chart-title">Margin by Material</div>
        <canvas id="chart-margins" height="200"></canvas>
      </div>
    </div>

    ${lowStockMats.length ? `
    <div class="chart-card full" style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-lg);padding:var(--space-5);margin-bottom:var(--space-6)">
      <div class="chart-title">Low Stock Materials ⚠</div>
      <canvas id="chart-lowstock" height="180"></canvas>
    </div>
    ` : ''}

    <div class="section-heading">Recent Invoices</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>
          ${recentInvoices.length ? recentInvoices.map((inv: Invoice) => `
            <tr>
              <td data-label="#" style="font-weight:600">${esc(inv.invoice_number)}</td>
              <td data-label="Customer">${esc(inv.customer_name)}</td>
              <td data-label="Total" style="font-family:var(--ff-mono);font-weight:600">${fmtPeso(Number((inv as any).adjusted_total ?? inv.total))}</td>
              <td data-label="Status"><span class="status-badge ${inv.status}">${inv.status}</span></td>
              <td data-label="Date">${fmtDate(inv.issued_date)}</td>
            </tr>
          `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--c-text-muted);padding:2rem">No invoices yet — create one to see data here</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}
