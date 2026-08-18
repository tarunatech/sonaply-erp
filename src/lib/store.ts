import * as XLSX from "xlsx";

export interface Product {
  id: string;
  name: string;
  category: string;
  size: string;
  barcode: string;
}
export interface StockBatch {
  id: string;
  productId: string;
  productCode?: string;
  productName: string;
  category: string;
  batchNumber: string;
  supplier: string;
  quantity: number;
  rate: number;
  date: string;
  availableQty: number;
  damageQty: number;
  displayQty?: number;
  holdQty?: number;
  description?: string;
  isNil?: boolean;
  isCancelled?: boolean;
  isDeadStock?: boolean;
}
export interface Hold {
  id: string;
  clientName: string;
  clientPhone: string;
  productName: string;
  category: string;
  quantity: number;
  batchNo: string;
  holdDate: string;
  status: string;
}
export interface Purchase {
  id: string;
  supplierName: string;
  supplierPhone: string;
  productName: string;
  category: string;
  quantity: number;
  rate: number;
  totalAmount: number;
  batchNumber: string;
  date: string;
  description?: string;
}
export interface Sale {
  id: string;
  orderNo: string;
  customer: string;
  clientPhone: string;
  product: string;
  category: string;
  orderedQty: number;
  deliveredQty: number;
  pendingQty: number;
  rate?: number;
  GST?: number;
  totalPrice?: number;
  orderDate: string;
  valueCategory: string;
  batchNo?: string;
  damageQty?: number;
  isDamageSale?: boolean;
  remarks?: string;
  description?: string;
  status: "Pending" | "Confirmed" | "Partial" | "Delivered" | "Cancelled";
  stockCategory?: "Available" | "Display" | "Damage";
  createdAt?: string;
  updatedAt?: string;
  estimatedDeliveryDate?: string;
}
export interface SaleReturn {
  id: string;
  clientName: string;
  clientPhone: string;
  priceCategory: string;
  receiveDate: string;
  productName: string;
  quantity: number;
  batchNo?: string;
  notes?: string;
  createdAt?: string;
}
export interface Challan {
  id: string;
  challanNo: string;
  salesId: string;
  customer: string;
  clientPhone: string;
  product: string;
  batchNo: string;
  quantity: number;
  createdAt: string;
  notes?: string;
  isPrinted?: boolean;
  isBuilt?: boolean;
  isChallanGenerated?: boolean;
  isCancelled?: boolean;
  cancelledAt?: string;
  stockCategory?: "Available" | "Display" | "Damage";
  returnedQty?: number;
  restoredQty?: number;
  status: "Pending" | "Confirmed" | "Delivered" | "Cancelled";
}

export interface ChallanGroupItem {
  id?: string | number;
  salesId?: string | number;
  productName?: string;
  product?: string;
  quantity: number;
  batchNo?: string;
  notes?: string;
  stockCategory?: "Available" | "Display" | "Damage";
  stock_category?: "Available" | "Display" | "Damage";
}

export interface ChallanGroupUpdate {
  clientName?: string;
  customer?: string;
  clientPhone?: string;
  client_phone?: string;
  date?: string;
  items: ChallanGroupItem[];
}
export interface User {
  id: string;
  name: string;
  role: "Admin" | "Staff";
  email: string;
  password: string;
}
export interface Client {
  id: string;
  name: string;
  phone: string;
  priceCategory: string;
  createdAt: string;
}

const API_URL = "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `HTTP error! status: ${res.status}`);
  }
  return res.json();
}

// Mapping helpers (snake_case from DB to camelCase for frontend)
const mapBatch = (b: any): StockBatch => ({
  id: b.id,
  productId: b.product_id,
  productCode: b.product_code,
  productName: b.product_name,
  category: b.category,
  batchNumber:
    b.batch_number && String(b.batch_number).trim()
      ? String(b.batch_number).trim()
      : "0",
  supplier: b.supplier,
  quantity: b.quantity,
  rate: Number(b.rate),
  date: b.date,
  availableQty: b.available_qty,
  damageQty: b.damage_qty,
  displayQty: b.display_qty || b.nil_qty,
  holdQty: b.hold_qty,
  description: b.description,
  isNil: b.is_nil,
  isCancelled: b.is_cancelled,
  isDeadStock: b.is_dead_stock,
});

const mapSale = (s: any): Sale => ({
  id: s.id,
  orderNo: s.order_no,
  customer: s.customer,
  clientPhone: s.client_phone,
  product: s.product,
  category: s.category,
  orderedQty: Number(s.ordered_qty || 0),
  deliveredQty: Number(s.delivered_qty || 0),
  pendingQty: Number(s.pending_qty || 0),
  rate: Number(s.rate || 0),
  GST: Number(s.GST || 0),
  totalPrice: Number(s.total_price || 0),
  orderDate: s.order_date,
  valueCategory: s.value_category,
  batchNo: s.batch_no,
  damageQty: s.damage_qty,
  isDamageSale: Number(s.damage_qty || 0) > 0,
  remarks: s.remarks,
  status: s.status,
  stockCategory: s.stock_category,
  createdAt: s.created_at,
  updatedAt: s.updated_at,
  estimatedDeliveryDate: s.estimated_delivery_date ? String(s.estimated_delivery_date).slice(0, 10) : undefined,
});

const mapSaleReturn = (r: any): SaleReturn => ({
  id: r.id,
  clientName: r.client_name,
  clientPhone: r.client_phone,
  priceCategory: r.price_category,
  receiveDate: r.receive_date,
  productName: r.product_name,
  quantity: Number(r.quantity),
  batchNo: r.batch_no,
  notes: r.notes,
  createdAt: r.created_at,
});

const mapChallan = (c: any): Challan => ({
  id: c.id,
  challanNo: c.challan_no,
  salesId: c.sales_id,
  customer: c.customer,
  clientPhone: c.client_phone,
  product: c.product,
  batchNo: c.batch_no,
  quantity: Number(c.quantity || 0),
  createdAt: c.created_at,
  notes: c.notes,
  isPrinted: c.is_printed,
  isBuilt: c.is_built,
  isChallanGenerated: c.is_challan_generated,
  isCancelled: c.is_cancelled,
  cancelledAt: c.cancelled_at,
  stockCategory: c.stock_category,
  returnedQty: c.returned_qty,
  restoredQty: c.restored_qty,
  status: c.status,
});

const mapPurchase = (p: any): Purchase => ({
  id: p.id,
  supplierName: p.supplier_name,
  supplierPhone: p.supplier_phone,
  productName: p.product_name,
  category: p.category,
  quantity: p.quantity,
  rate: Number(p.rate),
  totalAmount: Number(p.total_amount),
  batchNumber:
    p.batch_number && String(p.batch_number).trim()
      ? String(p.batch_number).trim()
      : "0",
  date: p.date,
});

export const getProducts = () => request<Product[]>("/products");
export const addProduct = (p: Omit<Product, "id">) =>
  request<Product>("/products", { method: "POST", body: JSON.stringify(p) });

// Batches
export interface GetBatchesParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
}

export interface StockStats {
  totalSales: number;
  availableStock: number;
  totalDisplay: number;
  totalDamage: number;
}

export interface PaginatedBatchesResponse {
  data: StockBatch[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  stats?: StockStats;
}

export const getBatches = async (): Promise<StockBatch[]> => {
  const data = await request<any[]>("/batches");
  return data.map(mapBatch);
};

export const getBatchesPaginated = async (
  params: GetBatchesParams = {},
): Promise<PaginatedBatchesResponse> => {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.search) query.set("search", params.search);
  if (params.category && params.category !== "all")
    query.set("category", params.category);

  const res = await request<any>(`/batches?${query.toString()}`);
  return {
    data: (res.data || []).map(mapBatch),
    total: res.total || 0,
    page: res.page || 1,
    limit: res.limit || 50,
    totalPages: res.totalPages || 1,
    stats: res.stats,
  };
};
export const addBatch = (b: Omit<StockBatch, "id">) => {
  const body = {
    product_id: b.productId,
    product_code: b.productCode,
    product_name: b.productName,
    category: b.category,
    batch_number: b.batchNumber,
    supplier: b.supplier,
    quantity: b.quantity,
    rate: b.rate,
    date: b.date,
    available_qty: b.availableQty,
    damage_qty: b.damageQty,
    display_qty: b.displayQty,
    description: b.description,
    is_nil: b.isNil || false,
    is_cancelled: b.isCancelled || false,
    is_dead_stock: b.isDeadStock || false,
  };
  return request<any>("/batches", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(mapBatch);
};
export const updateBatch = (id: string, updates: Partial<StockBatch>) => {
  const body: any = {};
  if (updates.availableQty !== undefined)
    body.available_qty = updates.availableQty;
  if (updates.damageQty !== undefined) body.damage_qty = updates.damageQty;
  if (updates.displayQty !== undefined) body.display_qty = updates.displayQty;
  if (updates.quantity !== undefined) body.quantity = updates.quantity;
  if (updates.rate !== undefined) body.rate = updates.rate;
  if (updates.productName) body.product_name = updates.productName;
  if (updates.category) body.category = updates.category;
  if (updates.batchNumber !== undefined)
    body.batch_number = updates.batchNumber || "0";
  if (updates.supplier) body.supplier = updates.supplier;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.isNil !== undefined) body.is_nil = updates.isNil;
  if (updates.isCancelled !== undefined)
    body.is_cancelled = updates.isCancelled;
  if (updates.isDeadStock !== undefined)
    body.is_dead_stock = updates.isDeadStock;

  return request<any>(`/batches/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  }).then(mapBatch);
};
export const deleteBatch = (id: string) =>
  request(`/batches/${id}`, { method: "DELETE" });

// Purchases
export const getPurchases = async () =>
  (await request<any[]>("/purchases")).map(mapPurchase);
export const addPurchase = (p: Omit<Purchase, "id">) => {
  const body = {
    supplier_name: p.supplierName,
    supplier_phone: p.supplierPhone,
    product_name: p.productName,
    category: p.category,
    quantity: p.quantity,
    rate: p.rate,
    total_amount: p.totalAmount,
    batch_number: p.batchNumber,
    date: p.date,
  };
  return request<any>("/purchases", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(mapPurchase);
};
export const updatePurchase = (id: string, updates: Partial<Purchase>) => {
  const body: any = {};
  if (updates.supplierName) body.supplier_name = updates.supplierName;
  if (updates.supplierPhone) body.supplier_phone = updates.supplierPhone;
  if (updates.productName) body.product_name = updates.productName;
  if (updates.quantity) body.quantity = updates.quantity;
  if (updates.batchNumber) body.batch_number = updates.batchNumber;
  if (updates.category) body.category = updates.category;
  return request<any>(`/purchases/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  }).then(mapPurchase);
};
export const deletePurchase = (id: string) =>
  request(`/purchases/${id}`, { method: "DELETE" });

// Holds
const mapHold = (h: any): Hold => ({
  id: h.id,
  clientName: h.client_name,
  clientPhone: h.client_phone,
  productName: h.product_name,
  category: h.category,
  quantity: h.quantity,
  batchNo: h.batch_no,
  holdDate: h.hold_date,
  status: h.status,
});
export const getHolds = async () =>
  (await request<any[]>("/holds")).map(mapHold);
export const addHold = (h: Omit<Hold, "id" | "status">) => {
  const body = {
    client_name: h.clientName,
    client_phone: h.clientPhone,
    product_name: h.productName,
    category: h.category,
    quantity: h.quantity,
    batch_no: h.batchNo,
    hold_date: h.holdDate,
  };
  return request<any>("/holds", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(mapHold);
};
export const releaseHold = (id: string) =>
  request(`/holds/${id}`, { method: "DELETE" });
export const cancelHold = (id: string) =>
  request(`/holds/cancel/${id}`, { method: "DELETE" });

// Sales
export const getSales = async () =>
  (await request<any[]>("/sales")).map(mapSale);
export const addSale = (
  s: Omit<Sale, "id" | "pendingQty" | "deliveredQty" | "orderNo"> & { status?: string },
) => {
  const body = {
    customer: s.customer,
    client_phone: s.clientPhone,
    product: s.product,
    category: s.category,
    ordered_qty: s.orderedQty,
    remarks: s.remarks,
    value_category: s.valueCategory,
    batch_no: s.batchNo,
    damage_qty: s.damageQty || 0,
    stock_category: s.stockCategory || "Available",
    order_date: s.orderDate,
    status: s.status,
  };
  return request<any>("/sales", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(mapSale);
};
export const addSaleBulk = (payload: {
  customer: string;
  clientPhone: string;
  orderDate: string;
  status: string;
  remarks?: string;
  category: string;
  items: any[];
}) => {
  return request<any[]>("/sales/bulk", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};
export const updateSale = (id: string, updates: Partial<Sale>) => {
  const body: any = {};
  if (updates.customer !== undefined) body.customer = updates.customer;
  if (updates.clientPhone !== undefined)
    body.client_phone = updates.clientPhone;
  if (updates.product !== undefined) body.product = updates.product;
  if (updates.orderedQty !== undefined) body.ordered_qty = updates.orderedQty;
  if (updates.category !== undefined) body.category = updates.category;
  if (updates.damageQty !== undefined) body.damage_qty = updates.damageQty;
  if (updates.remarks !== undefined) body.remarks = updates.remarks;
  if (updates.stockCategory !== undefined)
    body.stock_category = updates.stockCategory;
  if (updates.batchNo !== undefined) body.batch_no = updates.batchNo;
  if (updates.status !== undefined) body.status = updates.status;
  if (updates.estimatedDeliveryDate !== undefined)
    body.estimated_delivery_date = updates.estimatedDeliveryDate;
  return request<any>(`/sales/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  }).then(mapSale);
};
export const deleteSale = (id: string) =>
  request(`/sales/${id}`, { method: "DELETE" });

// Sales Returns
export const getSalesReturns = async () =>
  (await request<any[]>("/sales-returns")).map(mapSaleReturn);
export const addSalesReturn = (r: Omit<SaleReturn, "id" | "createdAt">) => {
  const body = {
    client_name: r.clientName,
    client_phone: r.clientPhone,
    price_category: r.priceCategory,
    receive_date: r.receiveDate,
    product_name: r.productName,
    quantity: r.quantity,
    batch_no: r.batchNo,
    notes: r.notes,
  };
  return request<any>("/sales-returns", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(mapSaleReturn);
};

export const updateSalesReturn = (id: string, updates: Partial<SaleReturn>) => {
  const body: any = {};
  if (updates.clientName !== undefined) body.client_name = updates.clientName;
  if (updates.clientPhone !== undefined) body.client_phone = updates.clientPhone;
  if (updates.priceCategory !== undefined) body.price_category = updates.priceCategory;
  if (updates.receiveDate !== undefined) body.receive_date = updates.receiveDate;
  if (updates.productName !== undefined) body.product_name = updates.productName;
  if (updates.quantity !== undefined) body.quantity = updates.quantity;
  if (updates.batchNo !== undefined) body.batch_no = updates.batchNo;
  if (updates.notes !== undefined) body.notes = updates.notes;

  return request<any>(`/sales-returns/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  }).then(mapSaleReturn);
};

export const deleteSalesReturn = (id: string) =>
  request(`/sales-returns/${id}`, { method: "DELETE" });

// Challans
export const getChallans = async () =>
  (await request<any[]>("/challans")).map(mapChallan);
export const generatePendingGroupChallan = (orderNo: string, salesIds?: (number | string)[]) =>
  request<any[]>("/challans/group/generate-pending", {
    method: "POST",
    body: JSON.stringify({ orderNo, salesIds }),
  }).then(list => list.map(mapChallan));
export const addChallan = (
  c: Omit<Challan, "id" | "challanNo"> & { status?: string },
) => {
  const body = {
    sales_id: c.salesId,
    quantity: c.quantity,
    batch_no: c.batchNo,
    notes: c.notes,
    stock_category: c.stockCategory || "Available",
    status: c.status || "Pending",
  };
  return request<any>("/challans", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(mapChallan);
};
export const updateChallan = (id: string, updates: Partial<Challan>) => {
  const body: any = {};
  if (updates.customer !== undefined) body.customer = updates.customer;
  if (updates.product !== undefined) body.product = updates.product;
  if (updates.quantity !== undefined) body.quantity = updates.quantity;
  if (updates.batchNo !== undefined) body.batch_no = updates.batchNo;
  if (updates.notes !== undefined) body.notes = updates.notes;
  if (updates.isPrinted !== undefined) body.is_printed = updates.isPrinted;
  if (updates.isBuilt !== undefined) body.is_built = updates.isBuilt;
  if (updates.isChallanGenerated !== undefined) body.is_challan_generated = updates.isChallanGenerated;
  if (updates.stockCategory !== undefined)
    body.stock_category = updates.stockCategory;
  if (updates.status !== undefined) body.status = updates.status;
  return request<any>(`/challans/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  }).then(mapChallan);
};
export const updateChallanGroup = (
  challanNumber: string,
  payload: ChallanGroupUpdate,
) =>
  request<any>(`/challans/group/${encodeURIComponent(challanNumber)}`, {
    method: "PUT",
    body: JSON.stringify({
      customer: payload.customer || payload.clientName,
      client_phone: payload.client_phone || payload.clientPhone,
      date: payload.date,
      items: payload.items.map((item) => ({
        id: item.id,
        salesId: item.salesId,
        product: item.productName || item.product,
        quantity: item.quantity,
        batch_no: item.batchNo,
        notes: item.notes,
        stock_category:
          item.stockCategory || item.stock_category || "Available",
      })),
    }),
  });
export const deleteChallan = (id: string) =>
  request(`/challans/${id}`, { method: "DELETE" });
export const deleteChallanGroup = (challanNumber: string) =>
  request(`/challans/group/${encodeURIComponent(challanNumber)}`, { method: "DELETE" });
export const cancelChallanGroup = (challanNumber: string) =>
  request<any>(`/challans/cancel/${encodeURIComponent(challanNumber)}`, {
    method: "PUT",
  });
export const deliverPendingChallan = (id: string) =>
  request<any>(`/challans/deliver/${id}`, { method: "PUT" });
export const confirmSale = (id: string) =>
  request<any>(`/sales/${id}/confirm`, { method: "PUT" });
export const deliverSale = (id: string) =>
  request<any>(`/sales/${id}/deliver`, { method: "PUT" });
export const confirmChallanGroup = (challanNo: string) =>
  request<any>(`/challans/group/${encodeURIComponent(challanNo)}/confirm`, { method: "PUT" });
export const deliverChallanGroup = (challanNo: string) =>
  request<any>(`/challans/group/${encodeURIComponent(challanNo)}/deliver`, { method: "PUT" });
// Users
export const getUsers = () => request<User[]>("/users");
export const addUser = (u: Omit<User, "id">) =>
  request<User>("/users", { method: "POST", body: JSON.stringify(u) });
export const deleteUser = (id: string) =>
  request(`/users/${id}`, { method: "DELETE" });

// --- Clients ---
const mapClient = (c: any): Client => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  priceCategory: c.price_category,
  createdAt: c.created_at,
});
export const getClients = () =>
  request<any[]>("/clients").then((data) => data.map(mapClient));
export const addClient = (c: Partial<Client>) =>
  request<any>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: c.name,
      phone: c.phone,
      price_category: c.priceCategory,
    }),
  }).then(mapClient);
export const updateClient = (id: string, c: Partial<Client>) =>
  request<any>(`/clients/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: c.name,
      phone: c.phone,
      price_category: c.priceCategory,
    }),
  }).then(mapClient);
export const deleteClient = (id: string) =>
  request(`/clients/${id}`, { method: "DELETE" });

export const addClientBulk = (
  clients: Array<{ name: string; phone?: string; priceCategory?: string }>
) =>
  request<{ success: boolean; count: number; skippedCount: number; clients: any[]; skipped: any[] }>("/clients/bulk", {
    method: "POST",
    body: JSON.stringify(
      clients.map((c) => ({
        name: c.name,
        phone: c.phone || "",
        price_category: c.priceCategory || "Regular",
      }))
    ),
  });

export const downloadClientTemplate = () => {
  const sampleData = [
    {
      "Name": "Sample Client Ltd",
      "Phone": "9876543210",
      "Price Category": "Regular",
    },
    {
      "Name": "Quality Timber Co.",
      "Phone": "9123456789",
      "Price Category": "Premium",
    },
  ];
  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Clients Template");
  XLSX.writeFile(workbook, "client_import_template.xlsx");
};

// Auth
export const login = async (
  email: string,
  password: string,
): Promise<User | null> => {
  try {
    const user = await request<User>("/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem("erp_currentUser", JSON.stringify(user));
    return user;
  } catch {
    return null;
  }
};
export const logout = () => localStorage.removeItem("erp_currentUser");
export const getCurrentUser = (): User | null => {
  try {
    return JSON.parse(localStorage.getItem("erp_currentUser") || "null");
  } catch {
    return null;
  }
};

// Export CSV
export const exportCSV = (
  data: Record<string, unknown>[],
  filename: string,
) => {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(","),
    ...data.map((r) => headers.map((h) => `"${r[h] ?? ""}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
};

// Date timezone-safe helper
export const getLocalDateString = (date = new Date()) => {
  return date.toLocaleDateString('en-CA'); // formats as YYYY-MM-DD
};

export const formatLocalDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '';
  const clean = String(dateStr).trim().slice(0, 10);
  if (clean.length === 10 && clean.includes('-')) {
    const parts = clean.split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // YYYY-MM-DD
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      } else if (parts[2].length === 4) {
        // DD-MM-YYYY
        return `${parts[0]}-${parts[1]}-${parts[2]}`;
      }
    }
  }
  return clean;
};

// WhatsApp
export const generateWhatsAppLink = (phone: string, message: string) => {
  const cleaned = phone.replace(/\D/g, "");
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
};

// Categories
export const CATEGORIES = [
  "FINE TOUCH",
  "FINE TOUCH LITE",
  "FINOBLE",
  "REAL PLUS",
  "REAL TOUCH",
  "ROXX LAM",
  "KIWI DECOR",
  "ELITE LAM",
  "ACRIKA",
  "KALAA",
  "YOUR DECOR",
];
