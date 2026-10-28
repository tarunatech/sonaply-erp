# Sonaply ERP — Master System Architecture, Module Workflows & Developer Handbook

> **Document Version:** 2.0.0  
> **Target Audience:** Full-stack developers, software engineers, and system architects onboarding or maintaining Sonaply ERP.  
> **System Purpose:** Enterprise Inventory, Order Booking, Multi-Warehouse Stock Tracking, Order Fulfillment, and Dispatch Logistics Management System for Plywood, Decorative Laminates, and Acrylic Sheet Wholesale/Retail.

---

## Table of Contents

1. [System Overview & High-Level Architecture](#1-system-overview--high-level-architecture)
   - 1.1 [Business Domain & Operating Model](#11-business-domain--operating-model)
   - 1.2 [Technical Stack & Architecture Topology](#12-technical-stack--architecture-topology)
   - 1.3 [State Management & Cross-Window Synchronization (`erp-stock-updated`)](#13-state-management--cross-window-synchronization-erp-stock-updated)
2. [Complete Database Schema & Relational Data Models](#2-complete-database-schema--relational-data-models)
   - 2.1 [Entity Relationship Diagram (ERD)](#21-entity-relationship-diagram-erd)
   - 2.2 [Table Definitions & Key Column Constraints](#22-table-definitions--key-column-constraints)
3. [Master Data Flow & Cross-Module Ripple Effect Matrix](#3-master-data-flow--cross-module-ripple-effect-matrix)
   - 3.1 [The "When Data Changes, Where Does It Go?" Matrix](#31-the-when-data-changes-where-does-it-go-matrix)
   - 3.2 [End-to-End Operational Lifecycle Diagram](#32-end-to-end-operational-lifecycle-diagram)
4. [In-Depth Module Workflows (Button-by-Button & Action-by-Action Guide)](#4-in-depth-module-workflows-button-by-button--action-by-action-guide)
   - 4.1 [Dashboard Module (`/`)](#41-dashboard-module-)
   - 4.2 [Stock List Module (`/stock`)](#42-stock-list-module-stock)
   - 4.3 [Stock Entry Module (`/stock-entry`)](#43-stock-entry-module-stock-entry)
   - 4.4 [Purchase Management Module (`/purchases`)](#44-purchase-management-module-purchases)
   - 4.5 [Sales & Order Booking Module (`/sales`)](#45-sales--order-booking-module-sales)
   - 4.6 [Pending Deliveries Module (`/pending-orders`)](#46-pending-deliveries-module-pending-orders)
   - 4.7 [Delivery Challans Module (`/challans`)](#47-delivery-challans-module-challans)
   - 4.8 [Delivered Deliveries Module (`/delivered-orders`)](#48-delivered-deliveries-module-delivered-orders)
   - 4.9 [Sales Return Management Module (`/sales-returns`)](#49-sales-return-management-module-sales-returns)
   - 4.10 [Stock Hold & Reservation Module (`/holds`)](#410-stock-hold--reservation-module-holds)
   - 4.11 [Daily Export & Operations Log (`/export`)](#411-daily-export--operations-log-export)
   - 4.12 [Clients Master Directory (`/clients`)](#412-clients-master-directory-clients)
   - 4.13 [User Management & Security Module (`/users`)](#413-user-management--security-module-users)
5. [Stock Maintenance Engine & Edge Case Resolution](#5-stock-maintenance-engine--edge-case-resolution)
   - 5.1 [Core Mathematical Formulas](#51-core-mathematical-formulas)
   - 5.2 [FIFO Stock Deduction Algorithm (`deductStock`)](#52-fifo-stock-deduction-algorithm-deductstock)
   - 5.3 [Reverse FIFO Stock Restoration Algorithm (`restoreStock`)](#53-reverse-fifo-stock-restoration-algorithm-restorestock)
   - 5.4 [Negative Stock Resolution Engine (`resolveNegativeStock`)](#54-negative-stock-resolution-engine-resolvenegativestock)
   - 5.5 [Full Product Reconciliation Engine (`reconcileAllProductStocks`)](#55-full-product-reconciliation-engine-reconcileallproductstocks)
   - 5.6 [Challan Splitting Engine (`CH-` vs `P-`)](#56-challan-splitting-engine-ch--vs-p-)
   - 5.7 [Challan Return Balancing Engine](#57-challan-return-balancing-engine)
6. [Third-Party Integrations & Technical Utilities](#6-third-party-integrations--technical-utilities)
   - 6.1 [Google Input Tools API & Offline Phonetic Gujarati Dictionary](#61-google-input-tools-api--offline-phonetic-gujarati-dictionary)
   - 6.2 [WhatsApp Universal Deep Link Generator](#62-whatsapp-universal-deep-link-generator)
   - 6.3 [SheetJS (`xlsx`) Excel Parser & Template Generator](#63-sheetjs-xlsx-excel-parser--template-generator)
   - 6.4 [Browser Printing Engine & `@media print` Formatting](#64-browser-printing-engine--media-print-formatting)
7. [Developer Quick Reference & Backend API Catalog](#7-developer-quick-reference--backend-api-catalog)
8. [Developer Onboarding & Local Development Setup](#8-developer-onboarding--local-development-setup)

---

## 1. System Overview & High-Level Architecture

### 1.1 Business Domain & Operating Model

**Sonaply ERP** is a high-throughput ERP and logistics fulfillment platform tailored specifically for the wholesale and retail decorative surfaces trade (decorative laminates, acrylic sheets, louvers, and plywood). 

In this domain, physical inventory moves through complex phases:
- Products have **Product Names** (design codes like `101 SF`, `804 GL`) and **Batch Numbers** (manufacturing lot numbers indicating dye lot/texture variation).
- Customers frequently order sheets that exceed immediate physical stock. Instead of rejecting the order, the system must **split** the order: fulfill what is on hand now with an active Delivery Challan (`CH-` prefix), while automatically parking the shortage in a draft backorder Challan (`P-` prefix) in the **Pending Deliveries** queue.
- Items are categorized into **Stock Categories**:
  - `Available`: Standard sellable inventory.
  - `Display`: Showroom sample folders (deducted from sellable inventory, cannot be dispatched as regular).
  - `Damage`: Broken or chipped sheets (tracked separately, sellable only at special discounted clearance).
  - `Hold`: Temporarily locked stock reserved for specific ongoing interior projects.
- Inward goods receipts (purchases) must dynamically resolve pre-existing negative inventory and backorders.
- Deliveries require billing synchronization: an order cannot be marked as delivered without a financial **Bill/Invoice Number**.

---

### 1.2 Technical Stack & Architecture Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENT TIER                               │
│       React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui          │
│       (Running on http://localhost:8080)                               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / JSON API Calls
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        VITE DEV REVERSE PROXY                          │
│     Maps `/api/*` requests ──► `http://localhost:5000/api/*`           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ RESTful HTTP Endpoints
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          APPLICATION SERVER                            │
│                 Node.js + Express.js (Port 5000)                       │
│                                                                        │
│  • Transaction Runner (`db.withTransaction`)                           │
│  • FIFO Stock Deductor (`deductStock`)                                 │
│  • Reverse FIFO Stock Restorer (`restoreStock`)                        │
│  • Negative Stock Resolver (`resolveNegativeStock`)                    │
│  • Full Product Stock Reconciler (`reconcileAllProductStocks`)         │
│  • Challan Return Balancer                                             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Connection Pooling (`pg` Client Pool)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                            DATABASE TIER                               │
│                       PostgreSQL Database                              │
│  • 10 Relational Tables        • Foreign Keys & Cascade Protections    │
│  • ACID Multi-row Transactions • 20+ Optimized B-Tree Indexes          │
└────────────────────────────────────────────────────────────────────────┘
```

#### Tech Stack Specification

| Component | Technology | Role in System |
|---|---|---|
| **Frontend Framework** | React 18.3 + TypeScript 5.8 | Type-safe Single Page Application (SPA). |
| **Build & Dev Tool** | Vite 5.4 | Ultra-fast HMR and build bundling. |
| **Styling & Components**| Tailwind CSS 3.4 + Radix UI (shadcn) | Consistent design system, modals, selects, popovers, responsive tables. |
| **Client State / Cache**| TanStack React Query v5 | Data fetching, automated caching, background invalidation. |
| **Icons & Visuals** | Lucide React + Recharts 2.15 | UI icons, bar charts, trend lines on Dashboard. |
| **Spreadsheets** | SheetJS (`xlsx` 0.18.5) | Client bulk import/export and formatted template generation. |
| **Backend Runtime** | Node.js + Express 4.x | REST API routes, stock allocation algorithms, transaction boundaries. |
| **Database Engine** | PostgreSQL 14+ | Persistent ACID storage with UUID primary keys and JSON handling. |
| **Database Driver** | `pg` (node-postgres) | Native connection pooling with transaction helper (`db.withTransaction`). |

---

### 1.3 State Management & Cross-Window Synchronization (`erp-stock-updated`)

Because warehouse operations frequently involve having multiple browser tabs open simultaneously (e.g., Tab 1: **Sales**, Tab 2: **Pending Deliveries**, Tab 3: **Challans**, Tab 4: **Stock List**), the application implements a decoupled, event-driven state invalidation architecture:

1. Whenever any module makes an inventory-altering mutation (sale booked, purchase inwarded, challan cancelled, hold released, return logged, delivery marked), it fires a custom DOM window event:
   ```ts
   window.dispatchEvent(new CustomEvent("erp-stock-updated"));
   ```
2. Every major page listens for this event in a `useEffect` hook:
   ```ts
   useEffect(() => {
     const handleStockUpdate = () => refresh();
     window.addEventListener("erp-stock-updated", handleStockUpdate);
     return () => window.removeEventListener("erp-stock-updated", handleStockUpdate);
   }, []);
   ```
3. This guarantees that if a warehouse supervisor records a purchase or confirms a challan in one tab, all other open screens instantly re-fetch server state without manual browser reloads.

---

## 2. Complete Database Schema & Relational Data Models

### 2.1 Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    USERS ||--o{ CHALLAN_NOTES : creates
    PRODUCTS ||--o{ BATCHES : groups
    CLIENTS ||--o{ SALES : places
    CLIENTS ||--o{ HOLDS : requests
    CLIENTS ||--o{ SALES_RETURNS : returns
    SALES ||--o{ CHALLANS : fulfills
    BATCHES ||--o{ PURCHASES : receives
    BATCHES ||--o{ CHALLANS : deducts_from
    BATCHES ||--o{ HOLDS : locks

    USERS {
        uuid id PK
        text name
        text role "Admin | Staff"
        text email UK
        text password
    }

    PRODUCTS {
        uuid id PK
        text name
        text category
        text size
        text barcode
        text status "Active | Inactive"
    }

    BATCHES {
        uuid id PK
        uuid product_id FK
        text product_name
        text category
        text batch_number
        text supplier
        int quantity "Total historical inward"
        numeric rate
        date date
        int available_qty "Current sellable balance"
        int damage_qty "Broken/defective balance"
        int display_qty "Showroom folder balance"
        int hold_qty "Reserved by Active Holds"
        int stock_maintain "Low-stock safety threshold"
        boolean is_nil "Zero-inventory marker"
        boolean is_cancelled "Not in Next Folder"
        boolean is_dead_stock "Clearance item"
        text description
        text status
    }

    PURCHASES {
        uuid id PK
        text supplier_name
        text supplier_phone
        text product_name
        text category
        int quantity "Inward sheets"
        numeric rate
        numeric total_amount
        text batch_number
        date date
    }

    SALES {
        uuid id PK
        text order_no "e.g. ORD-M7X2..."
        text customer
        text client_phone
        text product
        text category
        int ordered_qty "Total sheets booked"
        int delivered_qty "Delivered so far"
        int pending_qty "Unfulfilled sheets"
        numeric rate
        numeric GST
        numeric total_price
        date order_date
        text value_category
        text batch_no
        text stock_category "Available | Display | Damage"
        text remarks
        text status "Pending | Confirmed | Partial | Delivered | Cancelled"
        int damage_qty
        date estimated_delivery_date
        boolean is_order "Flag for picking stage"
        timestamp delivered_at
        timestamp created_at
        timestamp updated_at
    }

    CHALLANS {
        uuid id PK
        text challan_no "CH-xxxx or P-xxxx"
        uuid sales_id FK
        text customer
        text client_phone
        text product
        text batch_no
        int quantity "Sheets assigned to this slip"
        text status "Pending | Confirmed | Delivered | Cancelled"
        date created_at
        date delivery_date
        timestamp delivered_at
        text notes
        boolean is_printed
        text stock_category "Available | Display | Damage"
        boolean is_cancelled
        timestamp cancelled_at
        boolean is_built "Packing ready"
        boolean is_challan_generated "Challan generated"
        boolean is_order
        text bill_no "Financial invoice number"
        int restored_qty "Qty restored upon cancel"
        timestamp updated_at
    }

    SALES_RETURNS {
        uuid id PK
        text client_name
        text client_phone
        text price_category
        date receive_date
        text product_name
        int quantity "Returned sheets"
        text batch_no
        text notes
        timestamp created_at
    }

    CLIENTS {
        uuid id PK
        text name UK "English client name"
        text name_gujarati "Gujarati transliteration"
        text phone
        text price_category "Regular | Premium | Wholesale | VIP"
        timestamp created_at
    }

    HOLDS {
        uuid id PK
        text client_name
        text client_phone
        text product_name
        text category
        int quantity "Requested hold sheets"
        int held_qty "Physically locked sheets"
        text batch_no
        date hold_date
        text status "Active"
    }

    CHALLAN_NOTES {
        uuid id PK
        text note
        text status "Pending | Completed"
        text created_by
        timestamp created_at
        timestamp updated_at
    }
```

---

### 2.2 Table Definitions & Key Column Constraints

#### 1. `batches` Table (Inventory Ledger)
- **`quantity`**: The cumulative total of sheets received via Inward Purchase or Stock Entry.
- **`available_qty`**: The real-time sellable balance. Deducted on order booking (`deductStock`), restored on cancellation/return (`restoreStock`). Can be negative temporarily if items were sold in advance before purchase entry.
- **`hold_qty`**: Reserved by active records in `holds`. Cannot be deducted by regular sales.
- **`display_qty`**: Allocated to display folders. Deducted only if a sale specifies `stock_category = 'Display'`.
- **`damage_qty`**: Damaged sheets. Deducted only if a sale specifies `stock_category = 'Damage'`.
- **Classification Flags**:
  - `is_cancelled = TRUE`: Marked as "Not in Next Folder" (catalogue discontinued).
  - `is_dead_stock = TRUE`: Slow-moving clearance items.
  - `is_nil = TRUE`: Out-of-stock items deliberately kept to record demand.

#### 2. `sales` Table (Customer Orders)
- An order contains 1 or more rows sharing the same `order_no` (e.g., `ORD-M5KL89`).
- `ordered_qty`: Total quantity requested by client.
- `delivered_qty`: Cumulative quantity physically delivered across non-cancelled challans.
- `pending_qty`: Remainder yet to be delivered (`ordered_qty - delivered_qty`).
- `status`:
  - `Pending`: Newly booked order; not yet picked/delivered.
  - `Confirmed`: Picking confirmed; ready for dispatch.
  - `Partial`: Some items or quantities have been delivered, but pending quantity remains.
  - `Delivered`: All items and quantities have been delivered (`pending_qty == 0`).
  - `Cancelled`: All items in the order have been cancelled.

#### 3. `challans` Table (Dispatch & Fulfillment Slips)
- Each row links to a parent `sales(id)`. Multiple rows can share the same `challan_no` (grouped delivery).
- **Prefix Conventions:**
  - `CH-xxxx`: Active Delivery Challan for immediately fulfillable stock. Appears on **Delivery Challans** (`/challans`).
  - `P-xxxx`: Draft / Backorder Challan for stock shortages. Appears on **Pending Deliveries** (`/pending-orders`).
- `is_built`: Boolean flag indicating warehouse team has physically retrieved and staged the sheets.
- `is_challan_generated`: Flag indicating delivery invoice document was generated.
- `bill_no`: Physical/accounting tax invoice number (mandatory before delivery can be marked).

---

## 3. Master Data Flow & Cross-Module Ripple Effect Matrix

### 3.1 The "When Data Changes, Where Does It Go?" Matrix

This table is the primary reference for understanding how an action in one module cascades across the database and updates other screens:

| User Action / Event | Initiating Module | Database Tables Mutated | Columns Updated | Cascade Effect on Other Modules | Stock Movement |
|---|---|---|---|---|---|
| **Book New Sale** | `/sales` | `clients`<br>`sales`<br>`challans`<br>`batches` | `sales` inserted (`ordered_qty`, `pending_qty`)<br>`challans` inserted (`CH-` and/or `P-`)<br>`batches.available_qty` | **Stock List:** Available Qty drops immediately.<br>**Challans:** New `CH-` challan appears if stock available.<br>**Pending Deliveries:** New `P-` draft appears if shortage.<br>**Dashboard:** Total Sales count & sheet volume increments. | **Deducted** immediately via FIFO (`deductStock`). |
| **Edit Sale / Challan** | `/sales` (via Edit) | `sales`<br>`challans`<br>`batches` | `sales.ordered_qty`<br>`challans.quantity`<br>`batches.available_qty` | **Stock List:** Difference between old undelivered qty and new qty is restored or deducted.<br>**Pending Deliveries / Challans:** Quantities resized.<br>**Validation Guard:** Cannot reduce below already delivered qty! | **Restored then re-deducted** for the net delta. |
| **Cancel Challan** | `/challans` | `challans`<br>`sales`<br>`batches` | `challans.is_cancelled = TRUE`<br>`challans.status = 'Cancelled'`<br>`challans.restored_qty`<br>`sales.status` updated<br>`batches.available_qty` | **Stock List:** Restored stock reappears.<br>**Pending Deliveries:** Linked `P-` draft challans are auto-cancelled.<br>**Delivered Deliveries:** Not affected if only active challan cancelled.<br>**Dashboard:** Inventory figures refresh. | **Restored** to batch via reverse FIFO (`restoreStock`). |
| **Mark Challan Delivered** | `/challans` | `challans`<br>`sales` | `challans.status = 'Delivered'`<br>`challans.delivered_at`<br>`challans.delivery_date`<br>`challans.bill_no`<br>`sales.delivered_qty`<br>`sales.pending_qty`<br>`sales.status` | **Delivery Challans:** Disappears from active list.<br>**Delivered Deliveries:** Appears as completed delivery.<br>**Pending Deliveries:** Unhandled pending qty recalculated.<br>**Dashboard:** Recent deliveries and completed metrics update. | Stock was already deducted at booking; no further deduction needed. |
| **Confirm `P-` Challan** | `/pending-orders` | `challans`<br>`sales` | `challans.status = 'Confirmed'`<br>`sales.status = 'Confirmed'` | **Pending Deliveries:** Item confirmed.<br>**Delivery Challans:** Now visible in active dispatch queue ready to be packed and delivered. | Stock remains deducted. |
| **Create Inward Purchase** | `/purchases` | `purchases`<br>`batches` | `purchases` inserted<br>`batches.quantity` (+)<br>`batches.available_qty` (+) | **Stock List:** Available Qty and Total Inward increase.<br>**Pending Deliveries:** Negative balances neutralized via `resolveNegativeStock`; backorders can now be fulfilled.<br>**Dashboard:** Inventory metrics rise. | **Added** to inventory lot. |
| **Edit Inward Purchase** | `/purchases` | `purchases`<br>`batches` | `purchases` updated<br>`batches.quantity` (delta)<br>`batches.available_qty` (delta) | **Stock List:** Reverts old purchase quantity and applies new purchase quantity.<br>**Stock Balances:** Triggers `resolveNegativeStock`. | **Reverted & Re-applied**. |
| **Delete Inward Purchase** | `/purchases` | `purchases`<br>`batches` | `purchases` deleted<br>`batches.quantity` (-)<br>`batches.available_qty` (-) | **Stock List:** Inventory reduced by purchase quantity. | **Deducted** from batch. |
| **Create Stock Hold** | `/holds` or `/sales` | `holds`<br>`batches` | `holds` inserted (`quantity`, `held_qty`)<br>`batches.available_qty` (-)<br>`batches.hold_qty` (+) | **Stock List:** Available Qty decreases, Hold Qty increases.<br>**Holds Module:** Active hold row appears.<br>**Sales Module:** Other users cannot sell these locked sheets. | **Locked** (moved from Available to Hold). |
| **Release Hold to Sale** | `/holds` | `holds`<br>`sales`<br>`challans`<br>`batches` | `holds` deleted<br>`sales` inserted<br>`challans` inserted<br>`batches.hold_qty` (-) | **Holds Module:** Hold removed.<br>**Sales Module:** Order created with `ORD-` number.<br>**Delivery Challans / Pending:** `CH-` or `P-` generated.<br>**Stock List:** `hold_qty` cleared; available qty remains committed to the new sale. | **Transferred** from Hold directly into Order. |
| **Cancel Stock Hold** | `/holds` | `holds`<br>`batches` | `holds` deleted<br>`batches.hold_qty` (-)<br>`batches.available_qty` (+) | **Holds Module:** Hold row disappears.<br>**Stock List:** `hold_qty` drops, `available_qty` restored for general sale. | **Unlocked** back to Available stock. |
| **Log Sales Return** | `/sales-returns` | `sales_returns`<br>`batches` | `sales_returns` inserted<br>`batches.available_qty` (+) | **Stock List:** Available stock increases.<br>**Delivery Challans:** Return balancing engine reduces active customer challan balance dynamically.<br>**Dashboard:** Return metrics update. | **Restored** to batch via `restoreStock`. |
| **Replace Delivered Item** | `/delivered-orders` | `challans`<br>`sales`<br>`batches` | `challans.product`<br>`sales.product`<br>`batches.available_qty` | **Stock List:** Old product returned to stock; new replacement product deducted from stock.<br>**Delivered Deliveries:** Reflects updated product code. | Old item **restored**, new item **deducted**. |

---

### 3.2 End-to-End Operational Lifecycle Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Supplier as Supplier / Mill
    actor WhAdmin as Warehouse Manager
    actor Salesman as Sales Executive
    actor Dispatcher as Dispatch Staff
    actor Client as Customer / Architect

    Note over Supplier, WhAdmin: 1. Inward Procurement Flow
    Supplier->>WhAdmin: Delivers truckload of laminate sheets with invoice
    WhAdmin->>WhAdmin: Opens Purchase Module (/purchases)
    WhAdmin->>WhAdmin: Enters Supplier, Products, Lots, Rates, Quantities
    WhAdmin->>WhAdmin: Clicks "Record Purchase"
    WhAdmin-->>WhAdmin: Batches table updated (+qty, +available_qty)
    WhAdmin-->>WhAdmin: resolveNegativeStock() automatically satisfies past backorders

    Note over Salesman, Client: 2. Sales Booking & Split Allocation Flow
    Client->>Salesman: Calls with order for 50 sheets of "101 SF"
    Salesman->>Salesman: Opens Sales Module (/sales)
    Salesman->>Salesman: Selects Client, enters 50 sheets
    Salesman->>Salesman: Clicks "Book Order"
    Salesman-->>Salesman: System checks inventory: 30 available, 20 shortage
    Salesman-->>Salesman: Deducts 50 from batches (30 from lot, 20 advances lot to -20)
    Salesman-->>Salesman: Creates Sales record (ordered=50, pending=50)
    Salesman-->>Salesman: Creates CH-1045 for 30 sheets (Fulfillable)
    Salesman-->>Salesman: Creates P-1045 for 20 sheets (Backorder Shortage)
    Salesman->>Client: Clicks "Send WhatsApp" for instant booking receipt

    Note over Dispatcher, Client: 3. Picking, Packaging & Delivery Flow
    Dispatcher->>Dispatcher: Opens Challan Module (/challans)
    Dispatcher->>Dispatcher: Sees CH-1045 in Confirmed list
    Dispatcher->>Dispatcher: Clicks "Mark as Built" when physical sheets are pulled
    Dispatcher->>Dispatcher: Enters Accounting Bill No (e.g. "INV-9921")
    Dispatcher->>Dispatcher: Clicks "Print Challan" (Gujarati transliterated delivery slip)
    Dispatcher->>Client: Goods shipped to site; driver gets signed POD
    Dispatcher->>Dispatcher: Clicks "Deliver Challan"
    Dispatcher-->>Dispatcher: Challan status = 'Delivered', Sales delivered_qty = 30
    Dispatcher-->>Dispatcher: Moves to Delivered Deliveries (/delivered-orders)

    Note over WhAdmin, Dispatcher: 4. Backorder Fulfillment Flow
    WhAdmin->>WhAdmin: New stock arrives for "101 SF" in Purchase Module
    Dispatcher->>Dispatcher: Opens Pending Deliveries (/pending-orders)
    Dispatcher->>Dispatcher: Sees P-1045 for 20 sheets; stock is now available
    Dispatcher->>Dispatcher: Clicks "Confirm" on P-1045
    Dispatcher-->>Dispatcher: P-1045 converted to active CH- Delivery Challan!
    Dispatcher->>Dispatcher: Picks, enters Bill No, and delivers final 20 sheets
```

---

## 4. In-Depth Module Workflows (Button-by-Button & Action-by-Action Guide)

---

### 4.1 Dashboard Module (`/`)

#### Purpose
Executive dashboard providing real-time visibility into operational KPIs, financial volume, inventory health, and dispatch alerts.

#### Visual Layout & Key Metrics
- **Top KPI Cards:**
  - `Total Sales (₹)`: Aggregated gross sales value.
  - `Available Stock (Sheets)`: Net sellable sheets across all warehouse batches.
  - `Display Stock (Sheets)`: Sheets assigned to sample folders.
  - `Damage Stock (Sheets)`: Sheets defective or broken.
- **Analytics Charts:** Monthly Sales Trends (Bar Chart) and Category Distribution (Pie/Bar Chart).
- **Recent Orders Table:** Quick view of the latest 10 customer bookings.

#### Actions & Handlers
- **Date / Range Filter:** Allows filtering sales volume by month/year.
- **Click on Pending Alert:** Navigates directly to `/pending-orders`.
- **Click on Recent Order:** Navigates to `/sales` with pre-filtered order number.

---

### 4.2 Stock List Module (`/stock`)

#### Purpose
The primary inventory ledger. Supports multi-column filtering, inline editing, batch classification, and stock audits across thousands of product lines.

#### Key UI Elements & Columns
- **Product Name:** Code/Name of the laminate/plywood sheet.
- **Category:** Brand/Product collection (`FINE TOUCH`, `FINOBLE`, `REAL PLUS`, `ROXX LAM`, etc.).
- **Batch Number:** Manufacturer lot code (`0` represents default unassigned lot).
- **Quantities:** Total Inward (`quantity`), Available (`available_qty`), Display (`display_qty`), Damage (`damage_qty`), Hold (`hold_qty`), Stock Maintain Buffer (`stock_maintain`), Sold Qty (`calculated`).

#### Buttons & Actions

##### 1. "Filter Status" Toggle Tabs (`All`, `Regular`, `Not in Next Folder`, `Dead Stock`, `Nil Stock`)
- **What it does:** Filters batches based on boolean flags:
  - `Regular`: Standard active stock (`is_cancelled = FALSE`, `is_dead_stock = FALSE`, `is_nil = FALSE`).
  - `Not in Next Folder`: Discontinued designs (`is_cancelled = TRUE`).
  - `Dead Stock`: Clearance inventory (`is_dead_stock = TRUE`).
  - `Nil Stock`: Out-of-stock items (`is_nil = TRUE` or `available_qty = 0`).
- **Backend Route:** `GET /api/batches?stockStatus=...`

##### 2. "Column Filter" Popovers (Available Qty, Display, Damage, Hold, Maintain)
- **Presets Available:** `> 0`, `= 0`, `< 0`, or Custom Range `Min - Max`.
- **Client-Side/Server-Side Effect:** Triggers parameterized backend query:
  `GET /api/batches?minAvailable=...&maxAvailable=...`

##### 3. "Edit Batch" Button (Pencil Icon)
- **Prerequisites:** Requires Admin authentication.
- **Action:** Opens inline or modal editor for Product Name, Category, Batch Number, Supplier, Quantity, Available Qty, Display Qty, Damage Qty, Stock Maintain, Description, Rate.
- **Backend Route:** `PUT /api/batches/:id`
- **Data Mutated:** `batches` table row updated.
- **Cross-Module Ripple:** Dispatches `erp-stock-updated`. Instantly updates available stock in **Sales cart**, **Pending Deliveries**, and **Dashboard**.

##### 4. "Delete Batch" Button (Trash Icon)
- **Prerequisites:** Requires Admin password verification.
- **Action:** Permanently removes the batch from inventory.
- **Backend Route:** `DELETE /api/batches/:id`
- **Validation Guard:** Blocked if active non-cancelled challans or holds reference this batch.

##### 5. "Export CSV" Button
- **Action:** Generates a downloadable CSV containing the currently filtered dataset.

---

### 4.3 Stock Entry Module (`/stock-entry`)

#### Purpose
Enables warehouse supervisors to rapidly inward new physical stock or make manual inventory adjustments without generating an external supplier invoice.

#### Form Inputs
- `Product Name` (autocomplete from existing or free text).
- `Category` (dropdown or free text).
- `Batch Number` (string, defaults to `"0"`).
- `Quantity` (integer inward count).
- `Rate` (numeric purchase cost per sheet).
- Sub-allocations: `Display Qty`, `Damage Qty`, `Stock Maintain threshold`, `Description`.

#### Buttons & Actions

##### 1. "Save Stock Entry" Button
- **Validation:** Quantity must be $> 0$; Product Name and Category cannot be empty.
- **Backend Route:** `POST /api/batches`
- **Backend Logic:**
  1. Searches for existing batch matching `(LOWER(product_name), LOWER(batch_number))`.
  2. If found: updates `quantity = quantity + inward_qty`, `available_qty = available_qty + inward_qty`, and adds any display/damage sub-allocations.
  3. If not found: inserts a new row into `batches`.
  4. Calls `resolveNegativeStock(product_name)`: if earlier sales forced a negative balance on another lot of this product, the system automatically transfers positive stock to eliminate the deficit!
- **Cross-Module Ripple:** Dispatches `erp-stock-updated`. New stock is immediately available for sales booking; pending backorders on `/pending-orders` show fulfillable status.

---

### 4.4 Purchase Management Module (`/purchases`)

#### Purpose
Complete supplier procurement ledger. Tracks purchase dates, supplier phone numbers, unit rates, total amounts, and synchronizes inward receipts directly into warehouse stock batches.

#### Buttons & Actions

##### 1. "Record Purchase" Button (`handleSubmit`)
- **Prerequisites:** Supplier Name, at least one product line with valid Quantity and Rate.
- **Backend Route:** `POST /api/purchases` (runs inside `db.withTransaction`).
- **Data Mutated:**
  1. `purchases`: Inserts new purchase row with `total_amount = quantity * rate`.
  2. `batches`: Upserts inventory. If batch exists, increments `quantity` and `available_qty`. If not, creates new batch lot.
  3. Executes `resolveNegativeStock(product_name)`.
- **Cross-Module Ripple:**
  - **Stock List:** Available inventory increments.
  - **Pending Deliveries:** Stock shortages are resolved; warehouse staff can fulfill draft `P-` challans.
  - **Daily Export (`/export`):** Appears under the "Purchases" tab for accounting reconciliation.

##### 2. "Edit Purchase" Button (`handleEditDateGroup`)
- **Action:** Loads the purchase group into the editor form.
- **Backend Route:** `PUT /api/purchases/:id`
- **Data Mutated:**
  1. Calculates difference between old purchase quantity and new quantity.
  2. Reverts old stock on `batches` (`quantity - oldQty`, `available_qty - oldQty`).
  3. Applies new stock on `batches` (`quantity + newQty`, `available_qty + newQty`).
  4. Updates `purchases` record.
  5. Runs `resolveNegativeStock(product_name)`.
- **Stock Guard:** Ensures inventory never drifts when supplier bills are amended.

##### 3. "Delete Purchase" Button (`handleDeleteDateGroup`)
- **Prerequisites:** Confirmation dialog.
- **Backend Route:** `DELETE /api/purchases/:id`
- **Data Mutated:**
  1. Decrements `quantity` and `available_qty` on linked `batches` row.
  2. Deletes row from `purchases`.
- **Cross-Module Ripple:** Available stock drops on **Stock List**; fires `erp-stock-updated`.

##### 4. Date Filter Presets (`Today`, `Yesterday`, `This Month`, `Last 7 Days`, `Last 30 Days`)
- **Action:** Instant client-side/server-side date range filtering of procurement history.

---

### 4.5 Sales & Order Booking Module (`/sales`)

#### Purpose
The primary order creation engine. Manages multi-item shopping carts, client autocomplete, price categories, instant hold reservations, stock verification, and automated challan generation.

#### Multi-Item Cart Structure
Each cart row contains:
- `Product Name`: Autocomplete search showing current available stock.
- `Category`: Automatically populated from product.
- `Batch Number`: Dropdown showing existing batches with real-time stock balances.
- `Stock Category`: `Available`, `Display`, or `Damage`.
- `Quantity`: Number of sheets to book.
- `Rate`: Unit selling price.

#### Buttons & Actions

##### 1. "Book Order" Button (`handleSubmit`)
- **Prerequisites / Validation:**
  - Client must be selected or entered.
  - At least 1 product row with `quantity > 0` and `batchNo` specified.
  - Inactive products (`status = 'Inactive'`) are rejected.
- **Backend Route:** `POST /api/sales/bulk` (inside `db.withTransaction`).
- **Comprehensive Backend Execution:**
  1. **Client Upsert:** Inserts or updates client in `clients` table (`name`, `phone`, `price_category`).
  2. **Order Number Generation:** Generates unique `order_no` (e.g., `ORD-K7L92P`).
  3. **Stock Verification & Split Allocation:**
     - For each line item, queries matching batch availability.
     - Compares requested quantity against available stock:
       - `fulfillableQty = Math.min(requestedQty, totalAvailable)`.
       - `pendingRemaining = requestedQty - fulfillableQty`.
     - If `fulfillableQty > 0`: Generates a `CH-xxxx` active Delivery Challan number.
     - If `pendingRemaining > 0`: Generates a paired `P-xxxx` draft Challan number.
  4. **Immediate FIFO Stock Deduction:**
     - Calls `deductStock(product, batch, quantity, stockCategory)`.
     - Deducts stock immediately from matching lots in date order (`date ASC, id ASC`).
  5. **Database Inserts:**
     - `sales`: Inserts order row with `ordered_qty`, `delivered_qty = 0`, `pending_qty = ordered_qty`, `status = 'Pending'`.
     - `challans`: If fulfillable, inserts `CH-xxxx` row. If shortage, inserts `P-xxxx` row.
- **Cross-Module Ripple:**
  - **Stock List:** Available inventory drops instantly.
  - **Delivery Challans (`/challans`):** `CH-xxxx` appears immediately in the active dispatch queue.
  - **Pending Deliveries (`/pending-orders`):** `P-xxxx` draft appears immediately in the backorder queue.
  - **Dashboard:** Sales figures increment.
  - Dispatches `erp-stock-updated`.

##### 2. "Hold" Button (`handleHold`)
- **Action:** Instead of booking a confirmed sale, reserves the cart items as an architectural project hold.
- **Backend Route:** `POST /api/holds`
- **Effect:** Deducts `batches.available_qty` and adds to `batches.hold_qty`. Row inserted into `holds`. Stock is locked so no other salesman can sell it.

##### 3. "Send WhatsApp" Icon Button
- **Action:** Generates an encoded WhatsApp Universal Deep Link:
  `https://wa.me/{phone}?text=Dear%20{Customer},%20Order%20{OrderNo}%20confirmed...`
- **Effect:** Opens WhatsApp Web/App with formatted order breakdown and delivery status.

##### 4. "Edit Order" Mode (`handleSaveChallanEdit`)
- **Triggered When:** Arriving from `/challans` or `/pending-orders` via "Edit" button.
- **Backend Route:** `PUT /api/orders/group/:orderNo` or `PUT /api/challans/group/:challanNumber`.
- **Validation Guard:** Cannot reduce quantity below what is already delivered (`newQty < deliveredQty`). Cannot change product code on partially delivered items.
- **Stock Differential Logic:**
  - Restores undelivered portion of old items via `restoreStock()`.
  - Deducts newly requested items via `deductStock()`.
  - Recalculates challan allocations (`CH-` vs `P-`).

##### 5. "Delete Order" Button (`handleDelete`)
- **Prerequisites:** Only allowed if NO items have been delivered (`delivered_qty == 0`).
- **Backend Route:** `DELETE /api/sales/:id`
- **Effect:** Restores all deducted stock back to `batches.available_qty`, deletes linked challans, and marks/removes sales row.

---

### 4.6 Pending Deliveries Module (`/pending-orders`)

#### Purpose
Operations management center for order shortages, backorders, and draft `P-` challans. Displays all sales items where `pending_qty > 0`.

#### Key UI Elements
- Grouped by Customer and Order Number.
- Expandable items table showing Product, Batch, Ordered Qty, Delivered Qty, and Pending Qty.
- Real-time Total Stock badge showing whether newly arrived inventory can now fulfill the pending backorder.

#### Buttons & Actions

##### 1. "Confirm" Challan Button (`handleConfirmChallan`)
- **Applies To:** Backorder draft challans with `P-` prefix.
- **What it does:** Once warehouse has procured the missing stock, clicking Confirm transforms the draft `P-` challan into a confirmed active Delivery Challan (`CH-` status) and moves it to `/challans`.
- **Backend Route:** `PUT /api/challans/group/:challanNumber/confirm`
- **Data Mutated:** `challans.status = 'Confirmed'`.
- **Cross-Module Ripple:** Disappears from pending queue; appears in **Delivery Challans** (`/challans`) ready for physical packing and delivery slip printing.

##### 2. "Create Challan" Modal & Button (`handleCreateChallan`)
- **Applies To:** Unhandled pending quantities that do not yet have a `P-` draft challan.
- **Action:** Opens modal to specify partial fulfillment quantity, batch, and stock category.
- **Backend Route:** `POST /api/challans`
- **Effect:** Inserts new Delivery Challan (`CH-` or `P-`).

##### 3. "Cancel Pending Order" Button (`handleCancelPendingGroup`)
- **Action:** Cancels unfulfilled backorders for an order group.
- **Backend Route:** `PUT /api/pending-orders/group/:groupKey/cancel`
- **Data Mutated:**
  - Cancels active `P-` draft challans and restores their stock via `restoreStock()`.
  - Sets `sales.pending_qty = 0`.
  - If nothing was delivered, sets `sales.status = 'Cancelled'`.
  - If partial delivery occurred, sets `sales.status = 'Delivered'` (finalized at partial qty).
- **Cross-Module Ripple:** Clears backorder from pending deliveries; restores inventory to **Stock List**.

##### 4. "Estimated Delivery Date" Picker (`handleUpdateEstimatedDate`)
- **Action:** Updates the expected arrival date for the pending items.
- **Backend Route:** `PUT /api/sales/:id` (`estimatedDeliveryDate`).
- **Effect:** Saves date to `sales.estimated_delivery_date`. Allows filtering by delivery date for logistics planning.

##### 5. "Mark as Order" Checkbox (`handleToggleClassifyOrder`)
- **Action:** Toggles persistent `is_order` boolean on sales and challans.
- **Effect:** Highlights rows with distinct badge/color so packing staff know items are actively being pulled in the warehouse.

##### 6. "Export CSV" & "Print" Buttons
- **Action:** Generates picking list printout or CSV download for warehouse workers.

---

### 4.7 Delivery Challans Module (`/challans`)

#### Purpose
Core dispatch and logistics execution engine. Manages active `CH-` delivery slips, physical packing verification, bill number assignment, driver receipts, and proof of delivery.

#### Challan Group Card Elements
- Group Header: Challan No (`CH-xxxx`), Client Name, Gujarati Name, Client Phone, Date, Status (`Pending` | `Confirmed` | `Delivered` | `Cancelled`).
- Sibling Links: Clickable buttons linking to sibling `P-` backorders for the same customer.
- Bill No Input: Inline text input for financial accounting bill number.
- Action Buttons: `Deliver`, `Mark as Built`, `Challan Generated`, `Print`, `Edit`, `Cancel`.

#### Buttons & Actions

##### 1. "Deliver Challan" Button (`handleDeliverClick` ➔ `executeDeliver`)
- **Mandatory Validation:** **Bill No is strictly required!** If the user has not entered a Bill No, the system displays a destructive toast alert (`"Bill No Required: Please enter Bill No before delivering"`) and aborts the action.
- **Action:** Opens confirmation modal with default delivery date set to today. Clicking "Confirm Delivery" executes:
- **Backend Route:**
  1. `PUT /api/challans/:id` ➔ Saves `bill_no`.
  2. `PUT /api/challans/group/:challanNumber/deliver` ➔
     - Sets `challans.status = 'Delivered'`, `delivered_at = CURRENT_TIMESTAMP`, `delivery_date = deliveryDate`.
     - Updates linked `sales` records: increments `delivered_qty = delivered_qty + challan_qty`, decrements `pending_qty = pending_qty - challan_qty`.
     - Sets `sales.status`: If `pending_qty == 0` ➔ `'Delivered'`. If `pending_qty > 0` ➔ `'Partial'`.
- **Cross-Module Ripple:**
  - **Delivery Challans:** Challan is removed from the active dispatch view.
  - **Delivered Deliveries (`/delivered-orders`):** Appears as an archived, completed delivery.
  - **Pending Deliveries:** Unhandled pending balance refreshes.
  - Dispatches `erp-stock-updated`.

##### 2. "Save Bill No" (`handleBillNoSave`)
- **Action:** Triggered on blur or Enter key in Bill No input box.
- **Backend Route:** `PUT /api/challans/group/:challanNumber/bill` or `PUT /api/challans/:id`.
- **Data Mutated:** `challans.bill_no`.
- **Effect:** Persists invoice number across all items in the challan group.

##### 3. "Mark as Built" Button (`handleBuildToggle`)
- **Action:** Toggles `is_built` boolean on all items in the challan.
- **Backend Route:** `PUT /api/challans/:id` (`isBuilt: true | false`).
- **Effect:** Displays green "Built" badge. Signifies to truck loading team that sheets have been physically picked, banded, and placed in the dispatch staging bay.

##### 4. "Challan Generated" Button (`handleChallanGeneratedToggle`)
- **Action:** Toggles `is_challan_generated` boolean on all items in the challan.
- **Backend Route:** `PUT /api/challans/:id` (`isChallanGenerated: true | false`).
- **Effect:** Displays badge indicating physical paper slip has been generated.

##### 5. "Print Challan" Button (`printChallan`)
- **Action:**
  1. Sets `is_printed = TRUE` in database via `PUT /api/challans/:id`.
  2. Looks up Gujarati transliteration from `clients` table. If absent, calls Google Input Tools API.
  3. Formats print view with:
     - Company Header & Logo
     - Challan No, Bill No, Delivery Date
     - Customer Name in Gujarati & English
     - Line items: Product Code, Batch, Quantity, Narration Notes
     - Warehouse Dispatcher & Receiver Signature blocks.
  4. Triggers `window.print()`.

##### 6. "Edit Challan" Button (`handleEditChallan`)
- **Action:** Navigates to `/sales` with route state:
  `{ editChallan: { challanNumber, salesId, customer, items: [...] } }`.
- **Effect:** Loads order into Sales cart for adding items, changing batches, or resizing quantities.

##### 7. "Cancel Challan" Button (`handleCancel`)
- **Prerequisites:** Confirmation dialog (`"Cancel challan CH-xxxx? Stock will be restored."`).
- **Backend Route:** `PUT /api/challans/group/:challanNumber/cancel` (calls `handleCancelChallanGroup`).
- **Comprehensive Backend Execution:**
  1. Iterates over non-cancelled items in the challan.
  2. Restores inventory to `batches` via `restoreStock(product, batch, quantity, stockCategory)`.
  3. Updates challan: `is_cancelled = TRUE, status = 'Cancelled', restored_qty = quantity, cancelled_at = CURRENT_TIMESTAMP`.
  4. Cancels linked `P-` draft challans if this was the sole active delivery slip.
  5. Recalculates linked `sales` records:
     - Sums remaining delivered quantities from other challans.
     - Updates `sales.ordered_qty`, `delivered_qty`, `pending_qty`, and sets status to `Delivered`, `Partial`, or `Cancelled`.
- **Cross-Module Ripple:**
  - **Stock List:** Stock is restored to available inventory immediately.
  - **Pending Deliveries:** Unfulfilled remnants are cleared.
  - Dispatches `erp-stock-updated`.

##### 8. "Challan Notes" Drawer (`handleAddNote`, `handleCompleteNote`, `handleDeleteNote`)
- **Action:** Warehouse dispatch notepad for truck numbers, driver names, or site gate passes.
- **Backend Route:** `/api/challan-notes` (`POST`, `PUT`, `DELETE`).

---

### 4.8 Delivered Deliveries Module (`/delivered-orders`)

#### Purpose
Permanent historical archive of all delivered customer orders. Provides duplicate printouts, audit logs, and on-site product replacement adjustments.

#### Key UI Elements & Filters
- Date Range filter (From Date, To Date).
- Customer Name / Phone search.
- Bill No and Product Name filter.
- Grouped delivery cards with full product breakdown.

#### Buttons & Actions

##### 1. "Replace Product" Modal & Button
- **Business Use Case:** Customer calls after delivery stating that 2 sheets of wrong laminate design were shipped, or customer requested an on-site design swap.
- **Backend Route:** `PUT /api/delivered-orders/group/:challanNumber`
- **Backend Execution:**
  1. Reverts delivered quantity on the old product batch via `restoreStock()`.
  2. Deducts quantity from the new replacement product batch via `deductStock()`.
  3. Updates `challans.product` and `sales.product`.
  4. Runs `resolveNegativeStock()` on both products.
- **Cross-Module Ripple:** Stock balances for both affected products adjust on **Stock List**.

##### 2. "Print Duplicate Delivery Slip" Button
- **Action:** Re-prints the historical challan with original delivery date, bill number, and customer signature lines.

---

### 4.9 Sales Return Management Module (`/sales-returns`)

#### Purpose
Handles inward customer returns of excess or defective sheets, reconciles customer billing balances, and automatically returns undamaged sheets back into sellable inventory.

#### Form Inputs
- `Client Name` (autocomplete from `clients`).
- `Client Phone` & `Price Category`.
- `Product Name` & `Batch Number`.
- `Return Quantity` & `Receive Date`.
- `Reason / Notes` (e.g., "Site work completed, 3 sheets excess").

#### Buttons & Actions

##### 1. "Record Sales Return" Button
- **Backend Route:** `POST /api/sales-returns` (inside `db.withTransaction`).
- **Backend Execution:**
  1. Inserts record into `sales_returns` table.
  2. Restores inventory: calls `restoreStock(product_name, batch_no, quantity, "Available")`.
  3. Runs `reconcileAllProductStocks(product_name)`: recalculates available balances.
  4. Runs `resolveNegativeStock(product_name)`.
- **Cross-Module Ripple:**
  - **Stock List:** Available stock increases by returned quantity.
  - **Delivery Challans:** The Challan Return Balancing Engine dynamically checks returns for `(client, product, batch)` and displays returned credits on customer delivery cards.
  - **Daily Export (`/export`):** Appears under "Sales Returns" tab.
  - Dispatches `erp-stock-updated`.

##### 2. "Edit Sales Return" Button
- **Backend Route:** `PUT /api/sales-returns/:id`
- **Effect:** Reverts old return stock via `deductStock()`, applies new return stock via `restoreStock()`, updates `sales_returns` row, and re-reconciles product inventory.

##### 3. "Delete Sales Return" Button
- **Backend Route:** `DELETE /api/sales-returns/:id`
- **Effect:** Deducts previously restored stock from `batches` via `deductStock()`, removes row from `sales_returns`, and triggers stock reconciliation.

---

### 4.10 Stock Hold & Reservation Module (`/holds`)

#### Purpose
Allows architects and clients to reserve high-demand sheets for ongoing projects without immediately generating an invoice. Locks inventory so it cannot be sold to other clients.

#### Buttons & Actions

##### 1. "Release Hold" Button (`handleRelease`)
- **Action:** Converts the hold into a confirmed Sale and Delivery Challan.
- **Backend Route:** `DELETE /api/holds/:id`
- **Backend Execution:**
  1. Locks hold row with `SELECT ... FOR UPDATE`.
  2. Calculates physical stock available across the held batches.
  3. Decrements `batches.hold_qty`.
  4. Creates Sales record under a new `ORD-xxxx` number.
  5. Creates Delivery Challan (`CH-xxxx` if fulfillable, `P-xxxx` if shortage).
  6. Deletes hold row from `holds`.
- **Cross-Module Ripple:**
  - **Holds Page:** Hold is removed.
  - **Sales / Challans:** Order is created and appears on `/challans` or `/pending-orders`.
  - **Stock List:** `hold_qty` is cleared; available stock remains committed to the new sale.
  - Dispatches `erp-stock-updated`.

##### 2. "Cancel Hold" Button (`handleCancelHold`)
- **Prerequisites:** Confirmation dialog (`"Cancel this hold and restore quantity back to Available stock?"`).
- **Backend Route:** `DELETE /api/holds/cancel/:id`
- **Backend Execution:**
  1. Decrements `batches.hold_qty`.
  2. Increments `batches.available_qty`.
  3. Deletes hold row from `holds`.
- **Cross-Module Ripple:**
  - **Stock List:** `hold_qty` drops, `available_qty` is unlocked and restored for general sale.
  - Dispatches `erp-stock-updated`.

##### 3. "Edit Hold" Button (`handleEditHold`)
- **Action:** Navigates to `/sales` with route state:
  `{ editHold: { id, clientName, items: [...] } }`.
- **Effect:** Opens hold items in Sales cart for resizing or adding designs.

---

### 4.11 Daily Export & Operations Log (`/export`)

#### Purpose
Operational audit day-book. Provides consolidated daily logs of all transactions (Sales, Dispatches, Returns, Purchases) for physical stock audits and external Tally/Busy accounting reconciliation.

#### Tabs & Features
1. **Sales Tab:** All orders booked on selected date.
2. **Deliveries Tab:** All challans physically delivered on selected date with Bill Numbers.
3. **Sales Returns Tab:** All customer return receipts.
4. **Purchases Tab:** Inward vendor procurement receipts.
5. **Day Summary Metrics:** Total Sheets Inward, Total Sheets Outward, Net Inventory Shift, Total Financial Value.

#### Buttons & Actions
- **"Date Picker":** Selects specific calendar date.
- **"Export to Excel / CSV":** Generates formatted multi-tab or individual CSV export.
- **"Print Daily Summary":** Generates clean physical audit report.

---

### 4.12 Clients Master Directory (`/clients`)

#### Purpose
Central customer repository managing business names, Gujarati script transliterations, contact numbers, and price tiers.

#### Buttons & Actions

##### 1. "Auto Convert to Gujarati" Button
- **Action:** Reads the English client name and sends a request to Google Input Tools API (`https://inputtools.google.com/request?text={word}&itc=gu-t-i0-und...`).
- **Fallback:** If offline or network fails, matches against internal `COMMON_TRADE_MAP` dictionary (e.g. `PLYWOOD` ➔ `પ્લાયવુડ`).
- **Effect:** Fills the `name_gujarati` field automatically.

##### 2. "Save Client" Button
- **Backend Route:** `POST /api/clients` or `PUT /api/clients/:id`.
- **Data Mutated:** `clients` table (`name`, `name_gujarati`, `phone`, `price_category`).

##### 3. "Import Clients (Excel / CSV)" Button
- **Action:** Opens file picker for `.xlsx` / `.csv` spreadsheets.
- **Backend Route:** `POST /api/clients/bulk`
- **Conflict Handling:** Automatically detects duplicates by client name or phone number. Skips conflicting rows and returns a summary log (`imported: X, skipped: Y`).

##### 4. "Download Template" Button
- **Action:** Generates and downloads `client_import_template.xlsx` formatted with standard columns (`Name`, `Phone`, `Price Category`).

##### 5. "Delete Client" Button
- **Backend Route:** `DELETE /api/clients/:id`
- **Validation Guard:** Blocked if active sales or challans are linked to this client.

---

### 4.13 User Management & Security Module (`/users`)

#### Purpose
Role-Based Access Control (RBAC) restricted exclusively to `Admin` users.

#### Roles & Permissions Matrix
| Action / Capability | Admin Role | Staff Role |
|---|:---:|:---:|
| View Dashboard, Sales, Purchases, Stock, Challans | Yes | Yes |
| Book Orders & Record Purchases | Yes | Yes |
| Mark Challan as Delivered | Yes | Yes |
| Access User Management (`/users`) | Yes | Hidden from Sidebar / Blocked |
| Edit Batch / Overwrite Stock Quantities | Yes (Password Prompt) | Restricted |
| Delete Batch from Inventory | Yes (Password Prompt) | Restricted |
| Cancel Delivered Challan | Yes | Restricted |

---

## 5. Stock Maintenance Engine & Edge Case Resolution

### 5.1 Core Mathematical Formulas

$$\text{Total Inward Quantity} = \sum_{\text{Purchases}} \text{quantity} + \sum_{\text{StockEntry}} \text{quantity}$$

$$\text{Available Qty} = \text{Total Inward} - \sum_{\text{Active Challans}} \text{quantity} + \sum_{\text{Sales Returns}} \text{quantity} - \text{Display Qty} - \text{Damage Qty} - \text{Hold Qty}$$

$$\text{Sold Qty (Calculated)} = \max(0, \text{Quantity} - \text{Available Qty} - \text{Display Qty} - \text{Damage Qty} - \text{Hold Qty})$$

$$\text{Pending Order Qty} = \max(0, \text{Ordered Qty} - \text{Delivered Qty})$$

---

### 5.2 FIFO Stock Deduction Algorithm (`deductStock`)

Located in `server/index.js` at line 1461.

```js
async function deductStock(productName, batchNo, quantityToDeduct, stockCategory, client = null)
```

1. **Target Column Determination:**
   - If `stockCategory === 'Damage'`: deducts from `damage_qty`.
   - If `stockCategory === 'Display'`: deducts from `display_qty`.
   - Default: deducts from `available_qty`.
2. **Lot Selection:**
   - Queries batches for `LOWER(TRIM(product_name)) = LOWER(TRIM($1))`.
   - If `batchNo` is specified, matches exact batch number.
   - Orders lots strictly by date: `ORDER BY date ASC, id ASC` (First-In, First-Out).
3. **Sequential Deduction Loop:**
   - Iterates through batches in FIFO order.
   - Deducts `canDeduct = Math.min(remainingToSell, availableInBatch)`.
   - Updates `batches SET "{col}" = "{col}" - canDeduct WHERE id = batch.id`.
4. **Advance Shortage Handling (Negative Stock Prevention of Phantom Rows):**
   - If `remainingToSell > 0` (order exceeds total available stock across all lots), the algorithm deducts the remainder from the earliest existing lot (allowing it to go negative), **without creating phantom batch rows**.
   - When new purchase stock arrives later, `resolveNegativeStock()` automatically neutralizes this deficit.

---

### 5.3 Reverse FIFO Stock Restoration Algorithm (`restoreStock`)

Located in `server/index.js` at line 1540.

```js
async function restoreStock(productName, batchNo, quantityToRestore, stockCategory, client = null)
```

1. **Exact Batch Matching:**
   - Locates batches matching `product_name` and `batch_number`.
2. **Single Lot Case:**
   - If exactly 1 lot exists, updates directly: `UPDATE batches SET "{col}" = "{col}" + qty WHERE id = batch.id`.
3. **Multiple Lots Sharing Same Batch Number:**
   - Sorts lots in reverse chronological order: `[...lots].reverse()`.
   - Calculates deficit on each lot: `deficit = Math.max(0, lot.quantity - lot[col])`.
   - Restores stock to depleted lots first, preserving accurate historical balances.
4. **Triggers Negative Stock Resolution:**
   - Calls `resolveNegativeStock(productName, client)` immediately after restoration.

---

### 5.4 Negative Stock Resolution Engine (`resolveNegativeStock`)

Located in `server/index.js` at line 1614.

```js
async function resolveNegativeStock(productName, client = null)
```

1. Searches for any batch lot of `productName` where `available_qty < 0`, `display_qty < 0`, or `damage_qty < 0`.
2. If a negative lot exists, searches for other lots of the same product with positive balances (`> 0`).
3. Executes atomic balance transfer:
   ```sql
   UPDATE batches SET available_qty = available_qty - transfer WHERE id = posBatch.id;
   UPDATE batches SET available_qty = available_qty + transfer WHERE id = negBatch.id;
   ```
4. Eliminates negative balances automatically whenever new purchases or returns are posted.

---

### 5.5 Full Product Reconciliation Engine (`reconcileAllProductStocks`)

Located in `server/index.js` at line 1668.

```js
async function reconcileAllProductStocks(productName, client = null)
```

1. Fetches all physical batches for the specified product.
2. Fetches all active, non-cancelled challans (`is_cancelled = FALSE`).
3. Fetches all sales returns.
4. **Ambiguity Guard:** Verifies that no challans or returns contain unassigned/orphaned batches. If ambiguity is detected, preserves existing balances to prevent accidental overwrite.
5. For each exact batch lot, computes:
   $$\text{newAvail} = \text{initialQty} - \sum \text{ActiveChallans} + \sum \text{Returns} - \text{displayQty} - \text{damageQty} - \text{holdQty}$$
6. Updates `batches.available_qty` to eliminate any possible inventory drift.

---

### 5.6 Challan Splitting Engine (`CH-` vs `P-`)

Located in `server/index.js` inside `/api/sales/bulk` (lines 2250–2385):

```
                   [Customer Order: 50 Sheets]
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
       [Available Stock: 30]          [Stock Shortage: 20]
                 │                             │
                 ▼                             ▼
       [Active Delivery Challan]     [Backorder Draft Challan]
             CH-1024                       P-1024
          (Qty: 30 Sheets)              (Qty: 20 Sheets)
                 │                             │
                 ▼                             ▼
      Appears on: /challans        Appears on: /pending-orders
      (Ready for Dispatch)         (Awaiting Purchase Arrival)
```

- When the shortage arrives via Inward Purchase, warehouse staff click **"Confirm"** on `/pending-orders`, transforming `P-1024` into an active `CH-` Delivery Challan without re-entering client or product data.

---

### 5.7 Challan Return Balancing Engine

Located in `server/index.js` and `src/pages/ChallanPage.tsx`:
- When a customer returns goods, the return is logged in `sales_returns` with `(client_name, product_name, batch_no, quantity)`.
- On the Delivery Challan screen, the frontend matches non-cancelled returns against the customer's active challans.
- The returned quantity is subtracted from the active balance displayed on the delivery card, ensuring warehouse staff and drivers never over-bill or deliver goods that have been returned.

---

## 6. Third-Party Integrations & Technical Utilities

### 6.1 Google Input Tools API & Offline Phonetic Gujarati Dictionary

- **Endpoint:** `https://inputtools.google.com/request?text={WORD}&itc=gu-t-i0-und&num=5&cp=0&cs=1&ie=utf-8&oe=utf-8&app=test`
- **Method:** `GET`
- **Functionality:** Converts typed English phonetic words into Gujarati script (e.g., `"Shree Ram Timber"` ➔ `"શ્રી રામ ટીમ્બર"`).
- **Where Used:**
  1. `ClientsPage.tsx`: "Auto Convert to Gujarati" button on client creation.
  2. `ChallanPage.tsx`: Prints physical delivery challans with bilingual client names and transport narrations for Gujarati-speaking truck drivers.
- **Offline Fallback Dictionary (`COMMON_TRADE_MAP`):**
  Embedded in `src/lib/utils.ts` with 50+ trade-specific translations (`PLYWOOD` ➔ `પ્લાયવુડ`, `HARDWARE` ➔ `હાર્ડવેર`, `ACRYLIC` ➔ `એક્રેલિક`, `DOOR` ➔ `ડોર`, `LAMINATE` ➔ `લેમિનેટ`, etc.) ensuring 100% reliable transliteration even during Internet outages.

---

### 6.2 WhatsApp Universal Deep Link Generator

- **Protocol:** `https://wa.me/{phone}?text={encoded_message}`
- **Functionality:** Formats client order confirmations, challan numbers, sheet codes, and delivery status into an instant WhatsApp dispatch message.
- **Where Used:** `SalesPage.tsx` and `PendingDeliveries.tsx`.

---

### 6.3 SheetJS (`xlsx`) Excel Parser & Template Generator

- **Functionality:**
  1. **Template Download:** Generates standardized `.xlsx` files with preset header validation (`Name`, `Phone`, `Price Category`).
  2. **Bulk Parser:** Parses user-uploaded Excel spreadsheets with deduplication logic, conflict reporting, and row-by-row import logs.
- **Where Used:** `ClientsPage.tsx` (`handleFileUpload`, `downloadTemplate`).

---

### 6.4 Browser Printing Engine & `@media print` Formatting

- **Utilities:** `src/lib/print.ts` and Tailwind print stylesheets (`@media print`, `.no-print`).
- **Functionality:** Automatically strips out sidebar navigation, search bars, action buttons, and pagination headers during printing. Renders high-contrast thermal and A4 delivery challans with signature boxes.

---

## 7. Developer Quick Reference & Backend API Catalog

| HTTP Method | Route | Description | Request Body / Query Params | Database Tables Mutated |
|---|---|---|---|---|
| **POST** | `/api/login` | Authenticate user session | `{ email, password }` | None (reads `users`) |
| **GET** | `/api/batches` | Paginated stock list with filters | `?page=&limit=&search=&category=&stockStatus=&minAvailable=...` | None (reads `batches`) |
| **POST** | `/api/batches` | Create/merge stock entry | `{ product_name, category, batch_number, quantity, rate, ... }` | `batches` |
| **PUT** | `/api/batches/:id` | Inline update batch details | `{ available_qty, display_qty, damage_qty, rate, description, ... }` | `batches` |
| **DELETE** | `/api/batches/:id` | Delete batch (Admin only) | - | `batches` |
| **GET** | `/api/purchases` | List procurement bills | `?search=&supplier=&startDate=&endDate=` | None (reads `purchases`) |
| **POST** | `/api/purchases` | Record inward purchase & add stock | `{ supplier_name, product_name, category, quantity, rate, batch_number, date }` | `purchases`, `batches` |
| **PUT** | `/api/purchases/:id` | Edit purchase & reconcile stock delta | `{ quantity, rate, product_name, batch_number, ... }` | `purchases`, `batches` |
| **DELETE** | `/api/purchases/:id` | Delete purchase & deduct stock | - | `purchases`, `batches` |
| **GET** | `/api/sales` | List customer sales orders | `?status=&customer=&search=` | None (reads `sales`) |
| **POST** | `/api/sales/bulk` | Book order, deduct stock, split challan | `{ customer, clientPhone, orderDate, category, items: [...] }` | `clients`, `sales`, `challans`, `batches` |
| **PUT** | `/api/sales/:id` | Update individual sale item | `{ estimatedDeliveryDate, remarks, ... }` | `sales` |
| **PUT** | `/api/sales/classify-order` | Toggle order classified flag (`is_order`) | `{ orderNo, challanNo, salesIds, isOrder }` | `sales`, `challans` |
| **DELETE** | `/api/sales/:id` | Cancel sale & restore stock | - | `sales`, `challans`, `batches` |
| **GET** | `/api/challans` | List delivery challans | `?status=&customer=&search=` | None (reads `challans`) |
| **POST** | `/api/challans` | Create individual challan | `{ salesId, customer, product, quantity, batchNo, stockCategory, status }` | `challans` |
| **PUT** | `/api/challans/group/:challanNumber` | Update challan group items & stock | `{ customer, items: [...] }` | `challans`, `sales`, `batches` |
| **PUT** | `/api/challans/group/:challanNumber/confirm` | Confirm P- draft challan to active CH- | - | `challans`, `sales` |
| **PUT** | `/api/challans/group/:challanNumber/deliver` | Mark challan delivered & set bill no | `{ deliveryDate }` | `challans`, `sales` |
| **PUT** | `/api/challans/group/:challanNumber/cancel` | Cancel challan group & restore stock | - | `challans`, `sales`, `batches` |
| **PUT** | `/api/challans/group/:challanNumber/bill` | Assign financial bill number | `{ billNo }` | `challans` |
| **PUT** | `/api/delivered-orders/group/:challanNumber` | Replace delivered item & swap stock | `{ items: [{ oldProduct, newProduct, quantity, ... }] }` | `challans`, `sales`, `batches` |
| **GET** | `/api/sales-returns` | List sales return receipts | - | None (reads `sales_returns`) |
| **POST** | `/api/sales-returns` | Record return & restore stock | `{ client_name, product_name, quantity, batch_no, notes, receive_date }` | `sales_returns`, `batches` |
| **PUT** | `/api/sales-returns/:id` | Edit return & balance stock delta | `{ quantity, product_name, batch_no, ... }` | `sales_returns`, `batches` |
| **DELETE** | `/api/sales-returns/:id` | Delete return & deduct stock | - | `sales_returns`, `batches` |
| **GET** | `/api/holds` | List active stock holds | - | None (reads `holds`) |
| **POST** | `/api/holds` | Lock stock into hold reservation | `{ client_name, product_name, quantity, batch_no, category }` | `holds`, `batches` |
| **DELETE** | `/api/holds/:id` | Release hold to active Sale & Challan | - | `holds`, `sales`, `challans`, `batches` |
| **DELETE** | `/api/holds/cancel/:id` | Cancel hold & unlock stock to Available | - | `holds`, `batches` |
| **GET** | `/api/clients` | List customer master records | `?search=` | None (reads `clients`) |
| **POST** | `/api/clients` | Add single client | `{ name, name_gujarati, phone, price_category }` | `clients` |
| **POST** | `/api/clients/bulk` | Bulk import clients from Excel | `[ { name, phone, price_category }, ... ]` | `clients` |
| **PUT** | `/api/clients/:id` | Update client details | `{ name, name_gujarati, phone, price_category }` | `clients` |
| **DELETE** | `/api/clients/:id` | Delete client record | - | `clients` |
| **GET** | `/api/users` | List system users (Admin only) | - | None (reads `users`) |
| **POST** | `/api/users` | Create user account | `{ name, email, password, role }` | `users` |
| **DELETE** | `/api/users/:id` | Remove user account | - | `users` |
| **GET** | `/api/challan-notes` | Get dispatch notes | - | None (reads `challan_notes`) |
| **POST** | `/api/challan-notes` | Add dispatch note | `{ note, created_by }` | `challan_notes` |
| **DELETE** | `/api/challan-notes/:id` | Delete dispatch note | - | `challan_notes` |

---

## 8. Developer Onboarding & Local Development Setup

### 8.1 Prerequisites
- **Node.js:** v18.0.0 or higher
- **PostgreSQL:** v14.0 or higher
- **Git**

### 8.2 Environment Configuration
Create `server/.env` with your local database credentials:
```env
PORT=5000
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/sonaply_erp
DB_USER=postgres
DB_PASSWORD=yourpassword
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sonaply_erp
```

### 8.3 Database Setup
Initialize the database schema:
```powershell
cd server
npm install
node -e "require('./db').query(require('fs').readFileSync('./schema.sql', 'utf8')).then(() => console.log('Schema initialized!'))"
```

### 8.4 Running the Application
Open two terminal windows:

**Terminal 1: Backend API Server**
```powershell
cd server
node index.js
# Backend listening on http://localhost:5000
```

**Terminal 2: Frontend Client**
```powershell
npm install
npm run dev
# Frontend accessible at http://localhost:8080
```

### 8.5 Essential Rules for Writing New Features
1. **Always Wrap Stock Mutations in Transactions:**  
   Never modify `batches`, `sales`, or `challans` outside `db.withTransaction(async (client) => { ... })`. If an operation fails midway, all stock changes must roll back atomically.
2. **Never Create Phantom Batches:**  
   When deducting stock for orders that exceed inventory, deduct into a negative balance on the earliest lot rather than inserting phantom rows with random IDs.
3. **Always Dispatch `erp-stock-updated`:**  
   Whenever an API call mutates stock on the frontend, always fire `window.dispatchEvent(new CustomEvent("erp-stock-updated"))` so sibling tabs refresh their cache.
4. **Enforce Delivery Invariants:**  
   Never allow a delivery challan to be marked as `Delivered` without a valid `bill_no`.
5. **Protect Delivered Items on Edit:**  
   When updating an order or challan group, `newQuantity` cannot be less than `deliveredQty`. You cannot un-deliver goods that have already left the warehouse without an explicit return or replacement transaction.
