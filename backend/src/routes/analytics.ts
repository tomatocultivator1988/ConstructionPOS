import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';
import { getCached, setCache } from '../lib/cache';
import { requireAdmin } from '../lib/auth';

const router = Router();
router.use(requireAdmin);

// Product mix uses the cost captured on each invoice line. This keeps historical
// gross profit stable when a product's current cost or selling price changes.
router.get('/product-mix', async (req: Request, res: Response) => {
  try {
    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : '';
    const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : '';
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
    if ((from && !validDate(from)) || (to && !validDate(to))) {
      res.status(400).json({ error: 'Dates must use YYYY-MM-DD format.' }); return;
    }
    if (from && to && from > to) {
      res.status(400).json({ error: 'From date cannot be after To date.' }); return;
    }
    const periodClause = `${from ? " AND date(i.issued_date, '+8 hours') >= ?" : ''}${to ? " AND date(i.issued_date, '+8 hours') <= ?" : ''}`;
    const periodParams = [from, to].filter(Boolean);
    const db = getDb();
    const rows = await db.prepare(`
      WITH returned AS (
        SELECT invoice_item_id, SUM(quantity) AS returned_qty, SUM(total_credit) AS returned_credit
        FROM invoice_returns GROUP BY invoice_item_id
      ), sales_lines AS (
        SELECT ii.material_id,
          MAX(ii.quantity - COALESCE(r.returned_qty, 0), 0) AS quantity_sold,
          MAX(ii.total - COALESCE(r.returned_credit, 0), 0) AS revenue,
          MAX(ii.quantity - COALESCE(r.returned_qty, 0), 0) * COALESCE(ii.cost_price, 0) AS cogs
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN returned r ON r.invoice_item_id = ii.id
        WHERE i.status <> 'voided'${periodClause}
      )
      SELECT m.id, m.name, m.unit, m.stock, m.reorder_point,
        COALESCE(SUM(sl.quantity_sold), 0) AS quantity_sold,
        COALESCE(SUM(sl.revenue), 0) AS revenue,
        COALESCE(SUM(sl.cogs), 0) AS cogs
      FROM materials m
      LEFT JOIN sales_lines sl ON sl.material_id = m.id
      GROUP BY m.id
      ORDER BY revenue DESC, m.name ASC
    `).all(...periodParams);

    const mapped = rows.map(row => {
      const revenue = Math.round(Number(row.revenue || 0) * 100) / 100;
      const cogs = Math.round(Number(row.cogs || 0) * 100) / 100;
      const gross_profit = Math.round((revenue - cogs) * 100) / 100;
      return {
        id: row.id, name: row.name, unit: row.unit, stock: Number(row.stock || 0),
        reorder_point: Number(row.reorder_point || 0), quantity_sold: Number(row.quantity_sold || 0),
        revenue, cogs, gross_profit,
        margin_pct: revenue > 0 ? Math.round((gross_profit / revenue) * 1000) / 10 : 0,
      };
    });
    const totalRevenue = mapped.reduce((sum, row) => sum + row.revenue, 0);
    res.json({
      products: mapped.map(row => ({ ...row, sales_share_pct: totalRevenue > 0 ? Math.round((row.revenue / totalRevenue) * 1000) / 10 : 0 })),
      totals: {
        products: mapped.length,
        products_sold: mapped.filter(row => row.quantity_sold > 0).length,
        no_sales: mapped.filter(row => row.quantity_sold <= 0).length,
        revenue: Math.round(totalRevenue * 100) / 100,
        cogs: Math.round(mapped.reduce((sum, row) => sum + row.cogs, 0) * 100) / 100,
        gross_profit: Math.round(mapped.reduce((sum, row) => sum + row.gross_profit, 0) * 100) / 100,
      },
    });
  } catch (e: any) {
    console.error('Product mix error:', e.message);
    res.status(500).json({ error: 'Product mix temporarily unavailable', retryable: true });
  }
});

router.get('/dashboard', async (_req: Request, res: Response) => {
  const CACHE_KEY = 'analytics:dashboard';
  const cached = getCached<any>(CACHE_KEY);
  if (cached) { res.json(cached); return; }

  try {
    const db = getDb();
    const [
      topMaterials,
      profitTrend,
      stockValue,
      materialMargins,
      todaySales,
      todayProfit,
      todayExpenses,
      deliverySummary,
      weekRevenue,
      monthRevenue,
      lastMonthRevenue,
      yearRevenue,
      overallRevenue,
      monthlyTrend,
      topCustomers,
      expenseByCategory,
      pnlTrend,
      paymentMethodTotals,
      invoiceSummary,
      lowStockItems,
      averageMargin,
    ] = await Promise.all([
      db.prepare(`
        SELECT ii.material_id, m.name, m.unit, m.cost_price,
          SUM(ii.quantity) AS total_qty,
          SUM(ii.total) AS total_revenue,
          SUM(ii.quantity * COALESCE(ii.cost_price, m.cost_price, 0)) AS total_cost
        FROM invoice_items ii
        JOIN materials m ON m.id = ii.material_id
        WHERE ii.material_id IS NOT NULL AND EXISTS (SELECT 1 FROM invoices i WHERE i.id=ii.invoice_id AND i.status <> 'voided')
        GROUP BY ii.material_id
        ORDER BY total_qty DESC
        LIMIT 5
      `).all() as Promise<any[]>,
      db.prepare(`
        WITH dates AS (
          SELECT date('now', '+8 hours', '-' || (6 - t) || ' days') AS d
          FROM (SELECT 0 AS t UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6)
        )
        SELECT dates.d AS date,
          COALESCE(SUM(f.adjusted_total), 0) AS revenue,
          COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM dates
        LEFT JOIN v_invoice_financials f ON date(f.issued_date, '+8 hours') = dates.d AND f.status <> 'voided'
        LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        GROUP BY dates.d
        ORDER BY dates.d
      `).all() as Promise<any[]>,
      db.prepare(`
        SELECT SUM(stock * COALESCE(cost_price, 0)) AS total_cost,
          SUM(stock * price_per_unit) AS total_retail,
          COUNT(*) AS material_count
        FROM materials
      `).get() as Promise<any>,
      db.prepare(`
        SELECT name, unit, cost_price, price_per_unit, stock,
          (price_per_unit - cost_price) AS profit_per_unit,
          CASE WHEN price_per_unit > 0
            THEN ROUND(((price_per_unit - cost_price) / price_per_unit) * 100, 1)
            ELSE 0 END AS margin_pct
        FROM materials ORDER BY margin_pct DESC LIMIT 12
      `).all() as Promise<any[]>,
      db.prepare(`
        SELECT COALESCE(SUM(f.adjusted_total), 0) AS sales
        FROM v_invoice_financials f
        WHERE f.status <> 'voided' AND date(f.issued_date, '+8 hours') = date('now', '+8 hours')
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM v_invoice_financials f LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        WHERE f.status <> 'voided' AND date(f.issued_date, '+8 hours') = date('now', '+8 hours')
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS expenses
        FROM expenses
        WHERE date(expense_date) = date('now', '+8 hours')
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COUNT(*) AS assigned
        FROM invoices
        WHERE status <> 'voided' AND delivery_person IS NOT NULL AND trim(delivery_person) <> ''
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.status <> 'voided' AND p.payment_date >= datetime('now', '-7 days')
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(f.adjusted_total), 0) AS revenue,
          COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM v_invoice_financials f LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        WHERE f.status <> 'voided' AND strftime('%Y-%m', f.issued_date, '+8 hours') = strftime('%Y-%m', 'now', '+8 hours')
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(f.adjusted_total), 0) AS revenue,
          COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM v_invoice_financials f LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        WHERE f.status <> 'voided' AND strftime('%Y-%m', f.issued_date, '+8 hours') = strftime('%Y-%m', 'now', '+8 hours', '-1 month')
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(f.adjusted_total), 0) AS revenue,
          COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM v_invoice_financials f LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        WHERE f.status <> 'voided' AND strftime('%Y', f.issued_date, '+8 hours') = strftime('%Y', 'now', '+8 hours')
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(f.adjusted_total), 0) AS revenue,
          COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM v_invoice_financials f LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        WHERE f.status <> 'voided'
      `).get() as Promise<any>,
      db.prepare(`
        WITH months AS (
          SELECT strftime('%Y-%m', 'now', '+8 hours', '-' || (5 - t) || ' months') AS m
          FROM (SELECT 0 AS t UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5)
        )
        SELECT months.m AS month,
          COALESCE(SUM(f.adjusted_total), 0) AS revenue,
          COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM months LEFT JOIN v_invoice_financials f ON strftime('%Y-%m', f.issued_date, '+8 hours') = months.m AND f.status <> 'voided'
        LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        GROUP BY months.m ORDER BY months.m
      `).all() as Promise<any[]>,
      db.prepare(`
        SELECT COALESCE(c.name, 'Walk-in') AS name,
          COUNT(DISTINCT i.id) AS invoice_count, SUM(p.amount) - COALESCE(SUM((SELECT COALESCE(SUM(r.amount),0) FROM refunds r WHERE r.invoice_id=i.id)),0) AS total_paid
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
        LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.status <> 'voided'
        GROUP BY i.customer_id ORDER BY total_paid DESC LIMIT 5
      `).all() as Promise<any[]>,
      db.prepare(`SELECT category, COALESCE(SUM(amount),0) total FROM expenses GROUP BY category ORDER BY total DESC`).all() as Promise<any[]>,
      db.prepare(`
        WITH months AS (
          SELECT strftime('%Y-%m', 'now', '+8 hours', '-' || (5 - t) || ' months') AS month
          FROM (SELECT 0 AS t UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5)
        )
        SELECT months.month,
          COALESCE((SELECT SUM(f.net_sales) FROM v_invoice_financials f WHERE f.status <> 'voided' AND strftime('%Y-%m', f.issued_date, '+8 hours')=months.month),0) income,
          COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE strftime('%Y-%m', e.expense_date)=months.month),0) expenses
        FROM months ORDER BY months.month
      `).all() as Promise<any[]>,
      db.prepare(`
        SELECT p.method, COALESCE(SUM(p.amount),0) total
        FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.status <> 'voided'
        GROUP BY p.method ORDER BY total DESC
      `).all() as Promise<any[]>,
      db.prepare(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
          SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS partial,
          SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
          COALESCE(SUM(CASE WHEN status IN ('pending','partial') THEN adjusted_total - net_collections ELSE 0 END), 0) AS outstanding
        FROM v_invoice_financials WHERE status <> 'voided'
      `).get() as Promise<any>,
      db.prepare(`
        SELECT name, unit, stock, reorder_point FROM materials
        WHERE stock <= reorder_point ORDER BY (stock - reorder_point) ASC, name ASC LIMIT 25
      `).all() as Promise<any[]>,
      db.prepare(`
        SELECT COALESCE(AVG(CASE WHEN price_per_unit > 0 THEN ((price_per_unit - COALESCE(cost_price,0)) / price_per_unit) * 100 END), 0) AS value
        FROM materials
      `).get() as Promise<any>,
    ]);

    const result = {
      topMaterials: topMaterials.map(m => ({
        ...m,
        total_revenue: Math.round(m.total_revenue * 100) / 100,
        total_cost: Math.round(m.total_cost * 100) / 100,
        profit: Math.round((m.total_revenue - m.total_cost) * 100) / 100,
      })),
      profitTrend,
      stockValue: {
        total_cost: Math.round(stockValue.total_cost * 100) / 100,
        total_retail: Math.round(stockValue.total_retail * 100) / 100,
        material_count: stockValue.material_count,
      },
      materialMargins,
      todaySales: Math.round(Number(todaySales.sales || 0) * 100) / 100,
      todayProfit: Math.round(todayProfit.profit * 100) / 100,
      todayExpenses: Math.round(Number(todayExpenses.expenses || 0) * 100) / 100,
      deliverySummary: { assigned: Number(deliverySummary.assigned || 0) },
      weekRevenue: Math.round(weekRevenue.total * 100) / 100,
      monthRevenue: {
        revenue: Math.round(monthRevenue.revenue * 100) / 100,
        profit: Math.round(monthRevenue.profit * 100) / 100,
      },
      lastMonthRevenue: {
        revenue: Math.round(lastMonthRevenue.revenue * 100) / 100,
        profit: Math.round(lastMonthRevenue.profit * 100) / 100,
      },
      yearRevenue: {
        revenue: Math.round(yearRevenue.revenue * 100) / 100,
        profit: Math.round(yearRevenue.profit * 100) / 100,
      },
      overallRevenue: {
        revenue: Math.round(overallRevenue.revenue * 100) / 100,
        profit: Math.round(overallRevenue.profit * 100) / 100,
      },
      monthlyTrend,
      topCustomers,
      expenseByCategory,
      pnlTrend,
      paymentMethodTotals,
      invoiceSummary: {
        total: Number(invoiceSummary.total || 0),
        paid: Number(invoiceSummary.paid || 0),
        partial: Number(invoiceSummary.partial || 0),
        pending: Number(invoiceSummary.pending || 0),
        outstanding: Math.round(Number(invoiceSummary.outstanding || 0) * 100) / 100,
      },
      lowStockItems,
      lowStockCount: Number((await db.prepare('SELECT COUNT(*) AS total FROM materials WHERE stock <= reorder_point').get() as any).total || 0),
      averageMargin: Number(averageMargin.value || 0),
    };

    setCache(CACHE_KEY, result);
    res.json(result);
  } catch (e: any) {
    console.error('Analytics error:', e.message);
    res.json({
      topMaterials: [], profitTrend: [],
      stockValue: { total_cost: 0, total_retail: 0, material_count: 0 },
      materialMargins: [], todaySales: 0, todayProfit: 0, todayExpenses: 0, deliverySummary: { assigned: 0 }, weekRevenue: 0,
      monthRevenue: { revenue: 0, profit: 0 },
      lastMonthRevenue: { revenue: 0, profit: 0 },
      yearRevenue: { revenue: 0, profit: 0 },
      overallRevenue: { revenue: 0, profit: 0 },
      monthlyTrend: [], topCustomers: [],
      expenseByCategory: [], pnlTrend: [], paymentMethodTotals: [],
      invoiceSummary: { total: 0, paid: 0, partial: 0, pending: 0, outstanding: 0 }, lowStockItems: [], lowStockCount: 0, averageMargin: 0,
      error: 'Analytics temporarily unavailable',
      retryable: true,
    });
  }
});

export default router;
