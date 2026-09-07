interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
  borderWidth?: number;
  borderRadius?: number;
  borderSkipped?: boolean;
  hoverOffset?: number;
  type?: string;
  fill?: boolean;
  pointBackgroundColor?: string;
  pointBorderColor?: string;
  pointBorderWidth?: number;
  pointRadius?: number;
  pointHoverRadius?: number;
  tension?: number;
  order?: number;
}

interface ChartOptions {
  responsive?: boolean;
  maintainAspectRatio?: boolean;
  indexAxis?: 'x' | 'y';
  cutout?: string;
  interaction?: { intersect?: boolean; mode?: string };
  plugins?: {
    legend?: {
      display?: boolean;
      position?: 'top' | 'bottom' | 'left' | 'right';
      align?: 'start' | 'center' | 'end';
      labels?: {
        color?: string;
        padding?: number;
        font?: { size?: number; weight?: string };
        usePointStyle?: boolean;
        pointStyle?: string;
      };
    };
  };
  scales?: {
    x?: {
      beginAtZero?: boolean;
      grid?: { color?: string; display?: boolean };
      ticks?: { color?: string; font?: { size?: number }; callback?: (v: any) => string };
      max?: number;
    };
    y?: {
      beginAtZero?: boolean;
      grid?: { color?: string; display?: boolean };
      ticks?: { color?: string; font?: { size?: number }; callback?: (v: any) => string };
    };
  };
}

interface ChartConfig {
  type: string;
  data: {
    labels: string[];
    datasets: ChartDataset[];
  };
  options?: ChartOptions;
}

declare class Chart {
  constructor(ctx: CanvasRenderingContext2D, config: ChartConfig);
  destroy(): void;
}

interface Window {
  Chart: typeof Chart;
  closeModal: () => void;
  showCustomerModal: (data?: any) => void;
  saveCustomer: () => void;
  updateCustomer: (id: string) => void;
  editCustomer: (id: string) => void;
  delCustomer: (id: string) => void;
  showMaterialModal: (data?: any) => void;
  createMaterial: () => void;
  editMaterial: (id: string) => void;
  updateMaterial: (id: string) => void;
  delMaterial: (id: string) => void;
  showInvoiceDetail: (id: string) => void;
  recordPayment: (invoiceId: string) => void;
  voidInvoice: (invoiceId: string) => void;
  issueCreditMemo: (invoiceId: string) => void;
  recordRefund: (invoiceId: string) => void;
  delInvoice: (id: string) => void;
  printReceipt: (id: string) => void;
  saveSettings: () => void;
  openCashierShift: () => void;
  closeCashierShift: (id: string) => void;
  recordCashEvent: (id: string, type: string) => void;
  __customerNames: Record<string, string>;
  __materialNames: Record<string, string>;
  __invCustomers: any[];
  __invMaterials: any[];
  __invDefaultTax: string;
  __API_TOKEN: string;
}
