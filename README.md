# Sonaply ERP / Plywood ERP

Sonaply ERP is a lightweight inventory and order-management system for a plywood/laminate business. The application has a React + Vite frontend and an Express.js API backed by PostgreSQL.

The system helps manage stock batches, purchases, sales, holds, customer orders, pending deliveries, delivery challans, clients, users, exports, printing, and WhatsApp order communication.

---

## Tech Stack

### Frontend

- React 18
- TypeScript
- Vite
- React Router
- TanStack React Query
- Tailwind CSS
- shadcn/ui + Radix UI components
- Recharts for dashboard charts
- Vitest for tests

### Backend

- Node.js
- Express.js
- PostgreSQL via `pg`
- `dotenv` for backend environment variables
- `cors` for API access

---

## Project Structure

```text
sonaply-erp/
├── src/                    # React frontend
│   ├── App.tsx             # Auth gate, layout, routes
│   ├── main.tsx            # React app bootstrap
│   ├── components/         # Sidebar, navigation, shadcn/ui components
│   ├── hooks/              # UI hooks
│   ├── lib/
│   │   ├── store.ts        # Frontend API client + domain types/helpers
│   │   ├── print.ts        # Print helper
│   │   └── utils.ts        # Shared UI utilities
│   └── pages/              # Application modules/pages
├── server/                 # Express backend
│   ├── index.js            # API routes and server startup
│   ├── db.js               # PostgreSQL connection pool
│   ├── schema.sql          # Base database schema and admin seed
│   ├── *.js / *.cjs        # One-off migration scripts
│   └── .env                # Local backend environment variables
├── public/                 # Static assets
├── vite.config.ts          # Vite dev server and /api proxy config
├── package.json            # Frontend scripts/dependencies
└── README.md               # Project documentation
```

---

## Runtime Flow

1. `src/main.tsx` mounts the React app into `#root`.
2. `src/App.tsx` checks the current user from `localStorage` using `getCurrentUser()`.
3. If no user is logged in, `LoginPage` is shown.
4. After login, the app renders the main layout with `AppSidebar`, header, logout button, and route content.
5. Pages call functions from `src/lib/store.ts`.
6. `src/lib/store.ts` sends HTTP requests to `/api/...`.
7. During development, Vite proxies `/api` to `http://localhost:5000` as configured in `vite.config.ts`.
8. `server/index.js` handles API requests and uses `server/db.js` to query PostgreSQL.

```text
React Page → src/lib/store.ts → /api endpoint → Express route → PostgreSQL
```

---

## Frontend Routes and Modules

Routes are defined in `src/App.tsx`.

| Route | Page | Purpose |
|---|---|---|
| `/` | `Dashboard` | Business summary cards, monthly sales chart, stock category distribution |
| `/stock` | `StockList` | View/filter/manage stock batches |
| `/stock-entry` | `StockEntry` | Add or merge stock batch quantities |
| `/purchases` | `PurchasePage` | Record purchases and automatically update stock |
| `/sales` | `SalesPage` | Record sales, create orders, place items on hold |
| `/holds` | `HoldPage` | View active stock holds and release them back to available inventory |
| `/orders` | `OrderTracking` | Track grouped customer orders, statuses, challan generation, WhatsApp links |
| `/pending-orders` | `PendingOrders` | View unfulfilled quantities and generate fulfillment challans |
| `/delivered-orders` | `DeliveredOrders` | View delivered orders |
| `/challans` | `ChallanPage` | View, print, export, and delete delivery challans |
| `/export` | `DailyExport` | Export daily operational data |
| `/clients` | `ClientsPage` | Manage customer/client master data |
| `/users` | `UserManagement` | Admin-only user management |

The sidebar is defined in `src/components/AppSidebar.tsx`. The `/users` route is hidden for non-admin users.

---

## Core Business Flow

### Authentication

- Login calls `POST /api/login`.
- Users are checked against the `users` table by email and password.
- The logged-in user is saved in browser `localStorage` under `erp_currentUser`.
- `Admin` users can access user management; `Staff` users cannot.

> Note: The current implementation stores passwords in plain text and uses localStorage-based sessions. For production, add password hashing, secure sessions/JWTs, and authorization middleware.

### Stock Entry

- `StockEntry` loads existing batches.
- When adding stock, it checks for an existing batch by product name and category.
- If found, it increases `quantity` and `available_qty`.
- Otherwise it creates a new row in `batches`.

### Purchase Flow

- `PurchasePage` records supplier purchases.
- `POST /api/purchases` inserts purchase rows.
- The backend also updates matching stock batches by `batch_number` and `product_name`.
- If no batch exists, a new batch is created.

### Sales and Order Flow

- `SalesPage` requires selecting an existing client.
- A sale can contain multiple items.
- For each item:
  - `POST /api/sales` creates a sale.
  - Backend deducts available stock from matching batches in FIFO order by date.
  - `pending_qty` and `fulfilled_qty` are calculated.
  - `POST /api/orders` creates an order record for tracking.
- Sales also upsert client information in the `clients` table.

### Hold Flow

- From `SalesPage`, items can be placed on hold.
- `POST /api/holds` creates a hold record.
- Backend deducts from `available_qty` and increments `hold_qty` on batches.
- `HoldPage` can release a hold, returning stock to available inventory and reducing `hold_qty`.

### Order Tracking and Challans

- `OrderTracking` groups rows by `order_number`.
- Users can change order status, edit/delete orders, export/print orders, and generate challans.
- Creating a challan inserts into `challans` and marks the related order as `is_challan_generated`.
- If stock was already fulfilled, challan generation can skip additional stock deduction.

### Pending Orders

- `PendingOrders` shows orders with `pending_qty > 0` and not delivered.
- Generating a challan from this page fulfills the pending quantity, marks the order delivered, and deducts stock as required.

### Challan Printing

- `ChallanPage` groups rows by challan number.
- Full challans and compact delivery slips can be printed.
- Printed challans are marked with `is_printed = true`.
- Challans can be exported as CSV.

---

## Backend API Overview

Base URL in development:

```text
http://localhost:5000/api
```

The frontend uses relative `/api` URLs and relies on the Vite proxy in development.

| Area | Endpoints |
|---|---|
| Auth | `POST /api/login` |
| Products | `GET /api/products`, `POST /api/products` |
| Batches | `GET /api/batches`, `POST /api/batches`, `PUT /api/batches/:id`, `DELETE /api/batches/:id` |
| Purchases | `GET /api/purchases`, `POST /api/purchases`, `PUT /api/purchases/:id`, `DELETE /api/purchases/:id` |
| Sales | `GET /api/sales`, `POST /api/sales`, `PUT /api/sales/:id`, `DELETE /api/sales/:id` |
| Orders | `GET /api/orders`, `POST /api/orders`, `PUT /api/orders/:id`, `DELETE /api/orders/:id` |
| Challans | `GET /api/challans`, `POST /api/challans`, `PUT /api/challans/:id`, `DELETE /api/challans/:id` |
| Clients | `GET /api/clients`, `POST /api/clients`, `PUT /api/clients/:id`, `DELETE /api/clients/:id` |
| Users | `GET /api/users`, `POST /api/users`, `DELETE /api/users/:id` |
| Holds | `GET /api/holds`, `POST /api/holds`, `DELETE /api/holds/:id` |

---

## Database

The app uses PostgreSQL. The base schema is in `server/schema.sql`.

Main tables:

- `users`
- `products`
- `batches`
- `purchases`
- `sales`
- `orders`
- `challans`
- `clients`
- `holds`

The schema seeds a default admin user:

```text
Email: admin@erp.com
Password: admin123
Role: Admin
```

The login UI also mentions a staff demo user, but the base schema only seeds the admin user. Add a staff user manually or through the Users page after logging in as admin.

---

## Environment Variables

The backend explicitly loads environment variables from:

```text
server/.env
```

Created local file:

```env
PORT=5000
DB_USER=postgres
DB_HOST=localhost
DB_NAME=plywood_erp
DB_PASSWORD=password
DB_PORT=5432
```

Variables:

| Variable | Purpose | Default in code |
|---|---|---|
| `PORT` | Express server port | `5000` |
| `DB_USER` | PostgreSQL username | `postgres` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_NAME` | PostgreSQL database name | `plywood_erp` |
| `DB_PASSWORD` | PostgreSQL password | `password` |
| `DB_PORT` | PostgreSQL port | `5432` |

`.gitignore` excludes both `.env` and `server/.env`, so local secrets should not be committed.

---

## Setup Instructions

### 1. Install dependencies

From the project root:

```bash
npm install
```

The backend dependencies are already included in the root dependency tree through the project lockfile, but the `server/` folder also has its own `package.json`. If needed:

```bash
cd server
npm install
```

### 2. Create PostgreSQL database

Create a database matching `DB_NAME`:

```bash
createdb plywood_erp
```

Or use your PostgreSQL admin tool to create `plywood_erp`.

### 3. Load base schema

From the project root:

```bash
psql -U postgres -d plywood_erp -f server/schema.sql
```

### 4. Run migration scripts

Some columns/features are added by migration scripts that are not all present in the base schema. Run these after loading `schema.sql`:

```bash
node server/update_db.js
node server/update_db_holds.js
node server/add_pending_qty.cjs
node server/add_challan_flag_to_orders.cjs
node server/add_narration.js
node server/add_batch_status.js
node server/migrate_orders.js
```

### 5. Start backend server

From the project root:

```bash
npm run server
```

The backend starts on:

```text
http://localhost:5000
```

### 6. Start frontend dev server

In a second terminal:

```bash
npm run dev
```

The frontend starts on:

```text
http://localhost:8080
```

The frontend proxies `/api` requests to the backend.

---

## Available Scripts

Root `package.json` scripts:

| Script | Description |
|---|---|
| `npm run dev` | Start Vite frontend dev server on port 8080 |
| `npm run build` | Build production frontend bundle |
| `npm run build:dev` | Build frontend in development mode |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview production build |
| `npm run test` | Run Vitest tests once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run server` | Start Express backend with nodemon |

---

## Development Notes

- API client/domain types are centralized in `src/lib/store.ts`.
- Database columns are snake_case; frontend models are camelCase. Mapping helpers in `store.ts` convert backend rows to frontend types.
- Several update routes dynamically build SQL `SET` clauses from request body keys. Only send valid column names from trusted frontend code.
- Delete actions in some frontend pages use a hardcoded prompt password of `admin`; this is UI-level protection only and should be replaced with backend authorization for production.
- The app currently allows negative stock in some challan/order flows when a batch does not exist or stock is insufficient.

---

## Production Hardening Checklist

- Hash passwords with bcrypt/argon2.
- Add session/JWT authentication and backend authorization middleware.
- Validate request bodies with a schema library such as Zod.
- Restrict dynamic SQL update fields to allowlisted columns.
- Add proper migration tooling instead of one-off scripts.
- Add database indexes for frequently filtered columns such as `product_name`, `batch_number`, `order_number`, and `client_name`.
- Add automated backend tests for stock deduction, holds, order fulfillment, and challan generation.
- Serve the built frontend through a production web server or configure Express static hosting.
