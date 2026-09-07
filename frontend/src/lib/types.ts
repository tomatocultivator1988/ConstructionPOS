export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  tin: string | null;
  is_wholesale: number;
  created_at: string;
  updated_at: string;
}

export interface Material {
  id: string;
  name: string;
  unit: string;
  stock: number;
  cost_price: number;
  price_per_unit: number;
  wholesale_price: number;
  reorder_point: number;
  category: string;
  supplier_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  material_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  returned_quantity?: number;
  returned_total?: number;
  remaining_quantity?: number;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  payment_method: string;
  method: string;
  payment_date: string;
  notes: string | null;
}

export interface Invoice {
  id: string;
  customer_id: string | null;
  invoice_number: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  status: 'pending' | 'partial' | 'paid' | 'voided';
  issued_date: string;
  due_date: string | null;
  delivery_person?: string | null;
  paid_date: string | null;
  created_at: string;
  customer_name: string;
  items: InvoiceItem[];
  payments: Payment[];
}

export interface Analytics {
  topMaterials: any[];
  profitTrend: any[];
  stockValue: { total_cost: number; total_retail: number; material_count: number };
  materialMargins: any[];
  todaySales: number;
  todayProfit: number;
  todayExpenses: number;
  deliverySummary: { assigned: number };
  weekRevenue: number;
  monthRevenue: { revenue: number; profit: number };
  lastMonthRevenue: { revenue: number; profit: number };
  yearRevenue: { revenue: number; profit: number };
  overallRevenue: { revenue: number; profit: number };
  monthlyTrend: any[];
  topCustomers: any[];
}

export interface PaySummary {
  daily: { date: string; total: number }[];
  todayTotal: number;
}

export interface Expense {
  id: string;
  category: string;
  amount: number;
  description: string | null;
  vendor: string | null;
  expense_date: string;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tin: string | null;
  notes: string | null;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  supplier_id: string;
  supplier_name: string;
  po_number: string;
  status: 'pending' | 'received' | 'cancelled';
  total: number;
  order_date: string;
  received_date: string | null;
  created_at: string;
  items: PoItem[];
}

export interface PoItem {
  id: string;
  po_id: string;
  material_id: string | null;
  material_name: string;
  unit: string | null;
  description: string;
  quantity: number;
  unit_cost: number;
  total: number;
}

export interface StockMovement {
  id: string;
  material_id: string;
  material_name: string;
  unit: string;
  type: string;
  quantity: number;
  reference_id: string | null;
  reference_type: string | null;
  notes: string | null;
  created_at: string;
}
