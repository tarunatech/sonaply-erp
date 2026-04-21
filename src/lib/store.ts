export interface Product {
  id: string; name: string; category: string; thickness: string; size: string; barcode: string;
}
export interface StockBatch {
  id: string; productId: string; productCode?: string; productName: string; category: string; thickness: string;
  batchNumber: string; supplier: string; quantity: number; rate: number; date: string;
  warehouseLocation: string; availableQty: number; damageQty: number; nilQty?: number;
}
export interface Purchase {
  id: string; supplierName: string; supplierPhone: string; productName: string; category: string;
  quantity: number; rate: number; totalAmount: number; batchNumber: string; date: string;
}
export interface Sale {
  id: string; clientName: string; clientPhone: string; productName: string; category: string;
  quantity: number; rate?: number; totalPrice: number; orderDate: string; valueCategory: string;
}
export interface Order {
  id: string; orderNumber: string; clientName: string; clientPhone: string; productName: string;
  quantity: number; totalAmount: number; orderDate: string; status: 'Pending' | 'Confirmed' | 'Delivered' | 'Cancelled';
}
export interface User {
  id: string; name: string; role: 'Admin' | 'Staff'; email: string; password: string;
}

const KEYS = {
  products: 'erp_products',
  batches: 'erp_batches',
  purchases: 'erp_purchases',
  sales: 'erp_sales',
  orders: 'erp_orders',
  users: 'erp_users',
  currentUser: 'erp_currentUser',
};

function get<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function set<T>(key: string, data: T[]) { localStorage.setItem(key, JSON.stringify(data)); }
const uid = () => crypto.randomUUID();

// Products
export const getProducts = () => get<Product>(KEYS.products);
export const addProduct = (p: Omit<Product, 'id'>) => {
  const all = getProducts(); const item = { ...p, id: uid() }; all.push(item); set(KEYS.products, all); return item;
};

// Batches
export const getBatches = (): StockBatch[] => {
  const b = get<StockBatch>(KEYS.batches);
  
  const finobleCodes = ['BE 1028', 'BE 1029', 'BE 2052', 'BE 2060', 'BT 1008', 'BT 2004', 'CA 1015', 'CA 2034', 'CA 2035', 'CA 2042', 'CA 2043', 'CD 1032', 'CD 1108', 'CD 1111'];
  let added = false;
  
  finobleCodes.forEach(code => {
    const name = `FINOBLE ${code}`;
    if (!b.some(batch => batch.productName === name)) {
      b.push({
        id: uid(),
        productId: '',
        productCode: code,
        productName: name,
        category: 'Laminate',
        thickness: '1mm',
        batchNumber: '-',
        supplier: 'FINOBLE',
        quantity: 0,
        rate: 0,
        date: new Date().toISOString().slice(0, 10),
        warehouseLocation: 'Warehouse A',
        availableQty: 0,
        damageQty: 0,
        nilQty: 0
      });
      added = true;
    }
  });

  if (added) set(KEYS.batches, b);
  return b;
};
export const addBatch = (b: Omit<StockBatch, 'id'>) => {
  const all = getBatches(); const item = { ...b, id: uid() }; all.push(item); set(KEYS.batches, all); return item;
};
export const updateBatch = (id: string, updates: Partial<StockBatch>) => {
  const all = getBatches().map(b => b.id === id ? { ...b, ...updates } : b);
  set(KEYS.batches, all);
};
export const deleteBatch = (id: string) => {
  set(KEYS.batches, getBatches().filter(b => b.id !== id));
};

// Purchases
export const getPurchases = () => get<Purchase>(KEYS.purchases);
export const addPurchase = (p: Omit<Purchase, 'id'>) => {
  const all = getPurchases(); const item = { ...p, id: uid() }; all.push(item); set(KEYS.purchases, all); return item;
};

// Sales
export const getSales = () => get<Sale>(KEYS.sales);
export const addSale = (s: Omit<Sale, 'id'>) => {
  const all = getSales(); const item = { ...s, id: uid() }; all.push(item); set(KEYS.sales, all); return item;
};

// Orders
export const getOrders = () => get<Order>(KEYS.orders);
export const addOrder = (o: Omit<Order, 'id'>) => {
  const all = getOrders(); const item = { ...o, id: uid() }; all.push(item); set(KEYS.orders, all); return item;
};
export const updateOrder = (id: string, updates: Partial<Order>) => {
  const all = getOrders().map(o => o.id === id ? { ...o, ...updates } : o);
  set(KEYS.orders, all);
};

// Users
export const getUsers = (): User[] => {
  const u = get<User>(KEYS.users);
  if (u.length === 0) {
    const defaults: User[] = [
      { id: uid(), name: 'Admin', role: 'Admin', email: 'admin@erp.com', password: 'admin123' },
      { id: uid(), name: 'Staff User', role: 'Staff', email: 'staff@erp.com', password: 'staff123' },
    ];
    set(KEYS.users, defaults);
    return defaults;
  }
  return u;
};
export const addUser = (u: Omit<User, 'id'>) => {
  const all = getUsers(); const item = { ...u, id: uid() }; all.push(item); set(KEYS.users, all); return item;
};
export const deleteUser = (id: string) => {
  set(KEYS.users, getUsers().filter(u => u.id !== id));
};

// Auth
export const login = (email: string, password: string): User | null => {
  const user = getUsers().find(u => u.email === email && u.password === password);
  if (user) localStorage.setItem(KEYS.currentUser, JSON.stringify(user));
  return user || null;
};
export const logout = () => localStorage.removeItem(KEYS.currentUser);
export const getCurrentUser = (): User | null => {
  try { return JSON.parse(localStorage.getItem(KEYS.currentUser) || 'null'); } catch { return null; }
};

// Export CSV
export const exportCSV = (data: Record<string, unknown>[], filename: string) => {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [headers.join(','), ...data.map(r => headers.map(h => `"${r[h] ?? ''}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
};

// WhatsApp
export const generateWhatsAppLink = (phone: string, message: string) => {
  const cleaned = phone.replace(/\D/g, '');
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
};

// Categories
export const CATEGORIES = ['Plywood', 'Block Board', 'Flush Door', 'MDF', 'Particle Board', 'Veneer', 'Laminate', 'Other'];
export const THICKNESSES = ['4mm', '6mm', '8mm', '12mm', '16mm', '18mm', '19mm', '25mm'];
export const LOCATIONS = ['Warehouse A', 'Warehouse B', 'Warehouse C', 'Showroom Floor'];
