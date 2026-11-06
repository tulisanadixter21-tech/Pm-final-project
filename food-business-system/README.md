# Sarap Corner — Inventory and Sales Management System for Food Business

A complete, responsive, **permanently frontend-only** Inventory and Sales Management System (IMS + POS) built for small to medium food businesses. All application logic and records run locally inside the browser using **IndexedDB** and **LocalStorage**, with **Service Worker + Web App Manifest** support for offline operation and PWA installation.

---

## 1. Key Features

| Module | Capabilities |
| :--- | :--- |
| **Dashboard** | Live KPIs (Today's Sales, Total Transactions & Avg. Order Value, Total/Available/Low-Stock/Out-of-Stock Products), **Perishable Expiration Alerts banner & widget**, interactive **Sales Trends & Period Comparison** (Daily/Weekly/Monthly switcher, period-over-period `%` deltas, **Peak Sales Day & Peak Hour** detection), **Best-Selling Products** (toggleable by Quantity Sold vs Highest Revenue), **Slow-Moving Products** table, Inventory Status doughnut chart, Recent Transactions, and Low-Stock alerts. |
| **Product Management** | Full CRUD, category manager, unit of measurement selector, default shelf life & initial batch `Date Received` / `Expiration Date`, image upload with automatic client-side resize/preview, search, category/availability/status filters, sorting, validation, and CSV export. |
| **Inventory Tracking & Shelf Life (FEFO)** | Real-time stock monitoring (`In Stock`, `Low Stock`, `Out of Stock`) plus multi-batch **Expiration & Shelf-Life Tracking** with automatic remaining shelf-life calculation in days and 4 color-coded statuses (**Safe** green, **Nearing Expiration** yellow, **Expiring Very Soon** orange, **Expired** red). Includes **Expiring Soon & Batches** view, shelf-life filters (`All`, `Expiring Soon`, `Expired`, `Safe`), **Stock In** (creates dated batch), **Stock Out (FEFO)**, **Discard / Spoilage** recording, **Stock Adjustment**, and **Inventory Movement History**. |
| **Sales Management (POS)** | Fast counter interface with category tabs, product search/ID scan, cart quantity controls, percentage or fixed discounts, Guest or registered customer selection, quick-cash tenders, change calculation, **automatic FEFO (First Expired, First Out) batch deduction**, **automatic blocking of expired stock from being sold**, printable thermal receipt, and searchable Transaction History with **Void Transaction & Restore Stock** support. |
| **Customer Management** | Full CRUD, optional linking to POS sales (walk-in Guest orders never require registration), and live **Customer Purchase History** computed from stored completed sales records. |
| **Supplier Management** | Full CRUD, multi-select linking of supplied products, search/status/product filters, and CSV export. |
| **Reports & Sales Trends** | 10 reports (**Daily**, **Weekly**, **Monthly**, **Sales Transactions**, **Product Sales**, **Best-Selling Products** [rank by Qty or Revenue], **Slow-Moving Products**, **Inventory**, **Low Stock**, **Expiration & Shelf-Life**) plus a dedicated **Period-over-Period Comparison & Peak Sales Days/Hours** analytics panel, CSV export, and printable report view. Cancelled/voided transactions are excluded from completed sales. |
| **User Management** | Local demonstration login and role-based access for **Administrator** (full access) and **Authorized Staff** (configurable module permissions). |
| **Settings & Backup** | Business profile, currency (`PHP / ₱`), default low-stock threshold, **configurable expiration warning periods** (default `7`, `3`, and `1` days before expiration), receipt customization, UI preferences, **JSON Full Backup & Restore** (with schema validation), **CSV Exports** (including Batches & Expiry), and confirmed **Reset Demo Data**. |

---

## 2. Technology Stack

- **HTML5**, **CSS3**, **Vanilla JavaScript (ES6+)**
- **Bootstrap 5.3** & **Bootstrap Icons 1.11** (bundled locally under `assets/vendor/` — no CDN required)
- **Chart.js 4.4** (bundled locally under `assets/vendor/chartjs/`)
- **IndexedDB** (`FoodBusinessIMS`) for all application records
- **LocalStorage** for lightweight UI preferences and demo session state
- **Service Worker** (`sw.js`) & **Web App Manifest** (`manifest.json`) for offline caching and PWA installation

No backend, server, cloud database, or external API is used.

---

## 3. Project Structure

```text
food-business-system/
├── index.html
├── manifest.json
├── sw.js
├── README.md
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── assets/
    ├── css/
    │   └── style.css
    ├── images/
    ├── js/
    │   ├── utilities.js
    │   ├── storage.js
    │   ├── database.js
    │   ├── data.js
    │   ├── auth.js
    │   ├── dashboard.js
    │   ├── products.js
    │   ├── inventory.js
    │   ├── sales.js
    │   ├── customers.js
    │   ├── suppliers.js
    │   ├── reports.js
    │   ├── users.js
    │   ├── settings.js
    │   └── app.js
    └── vendor/
        ├── bootstrap/
        ├── bootstrap-icons/
        └── chartjs/
```

---

## 4. Running the Application

### Option A — Local Web Server (Recommended for PWA & Offline Service Worker)
Service Workers and PWA installation require `http://localhost` or `https://`. Run any static server inside the `food-business-system` folder:

```bash
# Using Python 3
cd food-business-system
python -m http.server 8080

# Or using Node.js
npx serve food-business-system -l 8080
```

Then open **`http://localhost:8080`** in Chrome, Edge, or Firefox.

### Option B — Direct File Open
You can also double-click `index.html` directly (`file://`). All modules and IndexedDB storage work normally; only Service Worker installation requires `http://localhost`.

---

## 5. Demo Accounts (Local Demonstration Login)

On the login screen you can click any of the quick-fill demo chips or enter:

| Username | Demo Password | Role | Assigned Modules |
| :--- | :--- | :--- | :--- |
| `admin` | `admin123` | **Administrator** | All 9 modules |
| `cashier` | `staff123` | **Authorized Staff** | Dashboard, Sales, Customers |
| `inventory` | `staff123` | **Authorized Staff** | Dashboard, Products, Inventory, Suppliers, Reports |

> **Important:** This is a local demonstration login stored in the browser's IndexedDB. Never enter real passwords or sensitive personal data.

---

## 6. Sample Food Products Seeded on First Launch

1. **Classic Burger** — ₱120.00
2. **Fries Large** — ₱55.50
3. **Iced Tea** — ₱25.00
4. **Cheese Pizza Slice** — ₱85.00
5. **Chocolate Cake** — ₱150.00 *(seeded in Low Stock state to demonstrate alerts)*
6. **Chicken Sandwich** — ₱95.00
7. **Spaghetti** — ₱100.00
8. **Fried Chicken** — ₱110.00
9. **Milk Tea** — ₱75.00
10. **Pancakes** — ₱90.00 *(seeded in Out of Stock state to demonstrate alerts)*

Sample data is initialized **only once** on first launch and is never overwritten unless you explicitly click **Reset to Sample Demo Data** in **Settings**.
