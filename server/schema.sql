-- Plywood ERP Database Schema

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Staff')),
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  size TEXT,
  barcode TEXT
);

CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  product_code TEXT,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  supplier TEXT,
  quantity INTEGER DEFAULT 0,
  rate NUMERIC DEFAULT 0,
  date DATE DEFAULT CURRENT_DATE,
  available_qty INTEGER DEFAULT 0,
  damage_qty INTEGER DEFAULT 0,
  display_qty INTEGER DEFAULT 0,
  hold_qty INTEGER DEFAULT 0,
  stock_maintain INTEGER DEFAULT 0,
  is_nil BOOLEAN DEFAULT FALSE,
  is_cancelled BOOLEAN DEFAULT FALSE,
  is_dead_stock BOOLEAN DEFAULT FALSE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name TEXT NOT NULL,
  supplier_phone TEXT,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  rate NUMERIC NOT NULL,
  total_amount NUMERIC NOT NULL,
  batch_number TEXT NOT NULL,
  date DATE DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no TEXT,
  customer TEXT NOT NULL,
  client_phone TEXT,
  product TEXT NOT NULL,
  category TEXT NOT NULL,
  ordered_qty INTEGER NOT NULL,
  delivered_qty INTEGER DEFAULT 0,
  pending_qty INTEGER DEFAULT 0,
  rate NUMERIC,
  "GST" NUMERIC DEFAULT 0,
  total_price NUMERIC,
  order_date DATE DEFAULT CURRENT_DATE,
  value_category TEXT,
  batch_no TEXT,
  stock_category TEXT DEFAULT 'Available',
  remarks TEXT,
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Partial', 'Delivered', 'Cancelled')),
  damage_qty INTEGER DEFAULT 0,
  delivered_at TIMESTAMP,
  estimated_delivery_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT NOT NULL,
  client_phone TEXT,
  price_category TEXT,
  receive_date DATE DEFAULT CURRENT_DATE,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  batch_no TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS challans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_no TEXT NOT NULL,
  sales_id UUID REFERENCES sales(id),
  customer TEXT NOT NULL,
  client_phone TEXT,
  product TEXT NOT NULL,
  batch_no TEXT,
  quantity INTEGER NOT NULL,
  created_at DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  is_printed BOOLEAN DEFAULT FALSE,
  stock_category TEXT DEFAULT 'Available',
  is_cancelled BOOLEAN DEFAULT FALSE,
  cancelled_at TIMESTAMP,
  is_built BOOLEAN DEFAULT FALSE,
  bill_no TEXT,
  restored_qty INTEGER,
  is_challan_generated BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'Delivered',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
 
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  name_gujarati TEXT,
  phone TEXT,
  price_category TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT NOT NULL,
  client_phone TEXT,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  held_qty INTEGER,
  batch_no TEXT,
  hold_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS challan_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed')),
  created_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial admin user
INSERT INTO users (name, role, email, password) 
VALUES ('Admin', 'Admin', 'admin@erp.com', 'admin123')
ON CONFLICT (email) DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sales_order_no ON sales(order_no);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer);
CREATE INDEX IF NOT EXISTS idx_sales_estimated_delivery ON sales(estimated_delivery_date);
CREATE INDEX IF NOT EXISTS idx_sales_order_date ON sales(order_date);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_challans_sales_id ON challans(sales_id);
CREATE INDEX IF NOT EXISTS idx_challans_customer ON challans(customer);
CREATE INDEX IF NOT EXISTS idx_challans_product ON challans(product);
CREATE INDEX IF NOT EXISTS idx_challans_cancelled ON challans(is_cancelled);
CREATE INDEX IF NOT EXISTS idx_challans_challan_no ON challans(challan_no);
CREATE INDEX IF NOT EXISTS idx_challans_created_at ON challans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batches_product_name ON batches(product_name);
CREATE INDEX IF NOT EXISTS idx_batches_category_lower ON batches(LOWER(category));
CREATE INDEX IF NOT EXISTS idx_batches_date_desc ON batches(date DESC);
CREATE INDEX IF NOT EXISTS idx_batches_prod_batch ON batches(LOWER(product_name), LOWER(batch_number));
CREATE INDEX IF NOT EXISTS idx_products_name_lower ON products(LOWER(TRIM(name)));
CREATE INDEX IF NOT EXISTS idx_sales_returns_product_name ON sales_returns(LOWER(TRIM(product_name)));
CREATE INDEX IF NOT EXISTS idx_sales_returns_client_name ON sales_returns(LOWER(TRIM(client_name)));
CREATE INDEX IF NOT EXISTS idx_clients_name_lower ON clients(LOWER(TRIM(name)));
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(TRIM(phone)) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_holds_client_name ON holds(LOWER(TRIM(client_name)));
CREATE INDEX IF NOT EXISTS idx_holds_status ON holds(status);
CREATE INDEX IF NOT EXISTS idx_purchases_prod_batch ON purchases(LOWER(TRIM(product_name)), LOWER(TRIM(batch_number)));
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date DESC);
CREATE INDEX IF NOT EXISTS idx_challan_notes_status ON challan_notes(status);
CREATE INDEX IF NOT EXISTS idx_challan_notes_created_at ON challan_notes(created_at DESC);
