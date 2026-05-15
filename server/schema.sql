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
  nil_qty INTEGER DEFAULT 0
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
  client_name TEXT NOT NULL,
  client_phone TEXT,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  rate NUMERIC,
  total_price NUMERIC,
  order_date DATE DEFAULT CURRENT_DATE,
  value_category TEXT,
  batch_no TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  total_amount NUMERIC,
  order_date DATE DEFAULT CURRENT_DATE,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Confirmed', 'Delivered', 'Cancelled')),
  batch_no TEXT
);

CREATE TABLE IF NOT EXISTS challans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_number TEXT UNIQUE NOT NULL,
  order_number TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  date DATE DEFAULT CURRENT_DATE,
  batch_no TEXT,
  notes TEXT,
  is_printed BOOLEAN DEFAULT FALSE
);
 
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  phone TEXT,
  price_category TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial admin user
INSERT INTO users (name, role, email, password) 
VALUES ('Admin', 'Admin', 'admin@erp.com', 'admin123')
ON CONFLICT (email) DO NOTHING;
