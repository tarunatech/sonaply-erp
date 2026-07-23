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
}
export interface Sale {
  id: string;
  clientName: string;
  clientPhone: string;
  productName: string;
  category: string;
  quantity: number;
  rate?: number;
  totalPrice: number;
  orderDate: string;
  valueCategory: string;
  batchNo?: string;
  pendingQty?: number;
  fulfilledQty?: number;
  damageQty?: number;
  isDamageSale?: boolean;
  narration?: string;
  stockCategory?: "Available" | "Display" | "Damage";
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
export interface Order {
  id: string;
  orderNumber: string;
  clientName: string;
  clientPhone: string;
  productName: string;
  quantity: number;
  totalAmount: number;
  orderDate: string;
  status: "Pending" | "Confirmed" | "Delivered" | "Cancelled";
  batchNo?: string;
  isChallanGenerated?: boolean;
  pendingQty?: number;
  fulfilledQty?: number;
  narration?: string;
  deliveredAt?: string;
  skipStockUpdate?: boolean;  stockCategory?: "Available" | "Display" | "Damage";
}
export interface Challan {
  id: string;
  challanNumber: string;
  orderNumber: string;
  clientName: string;
  clientPhone: string;
  productName: string;
  quantity: number;
  date: string;
  batchNo: string;
  notes?: string;
  shouldFulfill?: boolean;
  skipStockUpdate?: boolean;
  isPrinted?: boolean;
  isBuilt?: boolean;
  isCancelled?: boolean;
  cancelledAt?: string;
  stockCategory?: "Available" | "Display" | "Damage";
  returnedQty?: number;
  restoredQty?: number;
}

export interface ChallanGroupItem {
  id?: string;
  productName: string;
  quantity: number;
  batchNo?: string;
  notes?: string;
  stockCategory?: "Available" | "Display" | "Damage";
}

export interface ChallanGroupUpdate {
  clientName: string;
  clientPhone?: string;
  date: string;
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
  batchNumber: b.batch_number,
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
});

const mapOrder = (o: any): Order => ({
  id: o.id,
  orderNumber: o.order_number,
  clientName: o.client_name,
  clientPhone: o.client_phone,
  productName: o.product_name,
  quantity: o.quantity,
  totalAmount: Number(o.total_amount),
  orderDate: o.order_date,
  status: o.status,
  batchNo: o.batch_no,
  isChallanGenerated: o.is_challan_generated,
  pendingQty: o.pending_qty,
  fulfilledQty: o.fulfilled_qty,
  deliveredAt: o.delivered_at,
  stockCategory: o.stock_category,
  narration: o.narration,
});

const mapSale = (s: any): Sale => ({
  id: s.id,
  clientName: s.client_name,
  clientPhone: s.client_phone,
  productName: s.product_name,
  category: s.category,
  quantity: s.quantity,
  rate: Number(s.rate),
  totalPrice: Number(s.total_price),
  orderDate: s.order_date,
  valueCategory: s.value_category,
  batchNo: s.batch_no,
  pendingQty: s.pending_qty,
  fulfilledQty: s.fulfilled_qty,
  damageQty: s.damage_qty,
  isDamageSale: Number(s.damage_qty || 0) > 0,
  stockCategory: s.stock_category,
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
  challanNumber: c.challan_number,
  orderNumber: c.order_number,
  clientName: c.client_name,
  clientPhone: c.client_phone,
  productName: c.product_name,
  quantity: c.quantity,
  date: c.date,
  batchNo: c.batch_no,
  notes: c.notes,
  isPrinted: c.is_printed,
  isBuilt: c.is_built,
  isCancelled: c.is_cancelled,
  cancelledAt: c.cancelled_at,
  stockCategory: c.stock_category,
  returnedQty: c.returned_qty,
  restoredQty: c.restored_qty,
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
  batchNumber: p.batch_number,
  date: p.date,
});

export const getProducts = () => request<Product[]>("/products");
export const addProduct = (p: Omit<Product, "id">) =>
  request<Product>("/products", { method: "POST", body: JSON.stringify(p) });

// Batches
export const getBatches = async (): Promise<StockBatch[]> => {
  const data = await request<any[]>("/batches");
  return data.map(mapBatch);
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
  if (updates.batchNumber) body.batch_number = updates.batchNumber;
  if (updates.supplier) body.supplier = updates.supplier;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.isNil !== undefined) body.is_nil = updates.isNil;
  if (updates.isCancelled !== undefined)
    body.is_cancelled = updates.isCancelled;

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

// Sales
export const getSales = async () =>
  (await request<any[]>("/sales")).map(mapSale);
export const addSale = (
  s: Omit<Sale, "id" | "pendingQty" | "fulfilledQty">,
) => {
  const body = {
    client_name: s.clientName,
    client_phone: s.clientPhone,
    product_name: s.productName,
    category: s.category,
    quantity: s.quantity,
    rate: s.rate,
    total_price: s.totalPrice,
    order_date: s.orderDate,
    value_category: s.valueCategory,
    batch_no: s.batchNo,
    narration: s.narration,
    damage_qty: s.damageQty || 0,
    stock_category: s.stockCategory || "Available",
  };
  return request<any>("/sales", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(mapSale);
};
export const updateSale = (id: string, updates: Partial<Sale>) => {
  const body: any = {};
  if (updates.clientName) body.client_name = updates.clientName;
  if (updates.clientPhone) body.client_phone = updates.clientPhone;
  if (updates.productName) body.product_name = updates.productName;
  if (updates.quantity) body.quantity = updates.quantity;
  if (updates.category) body.category = updates.category;
  if (updates.damageQty !== undefined) body.damage_qty = updates.damageQty;
  if (updates.narration !== undefined) body.narration = updates.narration;
  if (updates.stockCategory) body.stock_category = updates.stockCategory;
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

// Orders
export const getOrders = async () =>
  (await request<any[]>("/orders")).map(mapOrder);
export const addOrder = (
  o: Omit<Order, "id">,
) => {
  const body = {
    order_number: o.orderNumber,
    client_name: o.clientName,
    client_phone: o.clientPhone,
    product_name: o.productName,
    quantity: o.quantity,
    total_amount: o.totalAmount,
    order_date: o.orderDate,
    status: o.status,
    batch_no: o.batchNo,
    pending_qty: o.pendingQty !== undefined ? o.pendingQty : o.quantity,
    fulfilled_qty: o.fulfilledQty !== undefined ? o.fulfilledQty : 0,
    narration: o.narration,
    stock_category: o.stockCategory || "Available",
  };
  return request<any>("/orders", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(mapOrder);
};
export const updateOrder = (id: string, updates: Partial<Order>) => {
  const body: any = {};
  if (updates.status) body.status = updates.status;
  if (updates.clientName) body.client_name = updates.clientName;
  if (updates.clientPhone) body.client_phone = updates.clientPhone;
  if (updates.productName) body.product_name = updates.productName;
  if (updates.quantity) body.quantity = updates.quantity;
  if (updates.totalAmount) body.total_amount = updates.totalAmount;
  if (updates.pendingQty !== undefined) body.pending_qty = updates.pendingQty;
  if (updates.fulfilledQty !== undefined)
    body.fulfilled_qty = updates.fulfilledQty;
  if (updates.batchNo !== undefined) body.batch_no = updates.batchNo;
  if (updates.skipStockUpdate !== undefined)
    body.skip_stock_update = updates.skipStockUpdate;
  if (updates.stockCategory) body.stock_category = updates.stockCategory;
  if (updates.narration !== undefined) body.narration = updates.narration;
  if (updates.status === "Delivered")
    body.delivered_at = new Date().toISOString();
  return request<any>(`/orders/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  }).then(mapOrder);
};
export const deleteOrder = (id: string) =>
  request(`/orders/${id}`, { method: "DELETE" });

// Challans
export const getChallans = async () =>
  (await request<any[]>("/challans")).map(mapChallan);
export const addChallan = (c: Omit<Challan, "id">) => {
  const body = {
    challan_number: c.challanNumber,
    order_number: c.orderNumber,
    client_name: c.clientName,
    client_phone: c.clientPhone,
    product_name: c.productName,
    quantity: c.quantity,
    date: c.date,
    batch_no: c.batchNo,
    notes: c.notes,
    should_fulfill: c.shouldFulfill,
    skip_stock_update: c.skipStockUpdate,
    stock_category: c.stockCategory || "Available",
  };
  return request<any>("/challans", {
    method: "POST",
    body: JSON.stringify(body),
  });
};
export const updateChallan = (id: string, updates: Partial<Challan>) => {
  const body: any = {};
  if (updates.clientName) body.client_name = updates.clientName;
  if (updates.productName) body.product_name = updates.productName;
  if (updates.quantity) body.quantity = updates.quantity;
  if (updates.batchNo) body.batch_no = updates.batchNo;
  if (updates.notes) body.notes = updates.notes;
  if (updates.isPrinted !== undefined) body.is_printed = updates.isPrinted;
  if (updates.isBuilt !== undefined) body.is_built = updates.isBuilt;
  if (updates.stockCategory) body.stock_category = updates.stockCategory;
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
      client_name: payload.clientName,
      client_phone: payload.clientPhone,
      date: payload.date,
      items: payload.items.map((item) => ({
        id: item.id,
        product_name: item.productName,
        quantity: item.quantity,
        batch_no: item.batchNo,
        notes: item.notes,
        stock_category: item.stockCategory || "Available",
      })),
    }),
  });
export const deleteChallan = (id: string) =>
  request(`/challans/${id}`, { method: "DELETE" });
export const cancelChallanGroup = (challanNumber: string) =>
  request<any>(`/challans/cancel/${encodeURIComponent(challanNumber)}`, {
    method: "PUT",
  });
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
