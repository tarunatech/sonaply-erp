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
  restored_qty INTEGER,
  is_challan_generated BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'Delivered'
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

-- Seed initial admin user
INSERT INTO users (name, role, email, password) 
VALUES ('Admin', 'Admin', 'admin@erp.com', 'admin123')
ON CONFLICT (email) DO NOTHING;
