# Implementation Walkthrough — Business Control MVP

This document summarizes the changes, codebase architecture, and usage guides for the Business Control MVP.

---

## 1. What was Built

A web application that digitises the stock, sales, expenses, cash, debtor, creditor, and closing books of a trading business. The application mirrors the physical documents 1-to-1:

### codebase Architecture:
- **Framework**: Next.js 14+ (TypeScript + App Router)
- **Database**: SQLite (managed via Prisma, ready to scale to Postgres by modifying the datasource provider in `prisma/schema.prisma`)
- **Styling**: TailwindCSS (with dark theme and glassmorphism elements)
- **Excel Parser**: SheetJS (`xlsx`) for data imports and template downloads
- **Testing**: Built-in Node.js test runner (`node --test`) for fast execution

---

## 2. Models Created

Prisma schema defines 16 models in `prisma/schema.prisma`:
- **Auth**: `User` (Owner & Staff roles)
- **Exchange**: `ExchangeRate` (Manage cost mappings)
- **Stock**: `Product` (Dual currency pricing) & `StockMovement` (Stock ledgers)
- **Sales**: `Sale` & `SaleItem` (Line items)
- **Expense**: `Expense` (Outflow tracker)
- **Cash**: `CashPosition` (Expected vs Counted cash audits)
- **Debtors**: `Debtor` & `DebtorTransaction` (Credit tracking)
- **Creditors**: `Creditor` & `CreditorTransaction` (Supplier liabilities)
- **Closing**: `DayClosing` (Locked status for daily closeout sign-offs)
- **Imports**: `ImportDocument`, `ImportRow`, & `ImportError` (Audit logs for uploads)

---

## 3. UI Screens Created

- **Dashboard (`/`)**: Main KPI board, today's summary panels, and low-stock table lists.
- **Import Data (`/import`)**: Drag-and-drop zone, detected type info, exchange rate form, and preview table.
- **Product Master (`/products`)**: Filterable product inventory ledger. Includes add product modal.
- **Daily Log (`/daily-log`)**: Unified forms for logging sales, expenses, and payments.
- **Sales (`/sales`)**: Logs showing cash/credit splits.
- **Expenses (`/expenses`)**: Categorized expense log.
- **Cash Position (`/cash`)**: Form showing the cash flow audit.
- **Debtors (`/debtors`)**: Client lists showing payment modals.
- **Creditors (`/creditors`)**: Vendor ledger.
- **Stock Ledger (`/stock-ledger`)**: Historical stock changes filterable by product.
- **End-of-Day Closing (`/closing`)**: Daily review and lock sign-off form.
- **Reports (`/reports`)**: Hub links to trigger print page styling.
- **Settings (`/settings/exchange-rate`)**: Manage USD/RMB conversion rate.
- **Login (`/api/auth/login` page)**: Gatekeep role features.

---

## 4. Run Guide

### 4.1 Prerequisites
Make sure Node.js is installed.

### 4.2 Start Dev Server
```bash
npm run dev
```

### 4.3 Database Management
```bash
npx prisma generate    # Generate client
npx prisma db push     # Sync changes to dev.db
node prisma/seed.js    # Seed admin users (owner/owner123 and staff/staff123)
```

### 4.4 Run Tests
```bash
npm test
```

---

## 5. Walkthrough Checklist

### 5.1 Import Products
1. Log in as `owner`.
2. Go to `/import`.
3. Select `Product List` file (or download template from reports page).
4. Review preview row status. Enter exchange rate if needed.
5. Click **Confirm Import**.
6. Redirects to `/products` showing cost RMB, selling RMB ($2 \times$ cost), and USD equivalent (cost $\times$ rate).

### 5.2 Record Shift Logs
1. Go to `/daily-log`.
2. Enter Cash Sales (decreases product inventory, increases expected cash sales).
3. Enter Credit Sales to client (decreases inventory, updates Debtor profile status to OPEN).
4. Enter Debtor payments received (decreases outstanding debt, increases cash position, status set to PART_PAID or PAID).

### 5.3 Close the Day
1. Go to `/closing`.
2. Review aggregated figures (opening cash, sales, payments, expected closing cash).
3. Count register drawer. Input counted cash and sign-off name.
4. Click **Close Day**. Status set to CLOSED, locking the log from modifications.

### 5.4 Print Daily Summary
1. Go to `/reports`.
2. Click **Print Daily Log** or **Print End-of-Day closing**.
3. Browser opens print preview page matching paper layout dimensions.

---

## 6. Known Limitations

- **Upload Naming**: Header mapper supports standard fuzzy matching. Check `docs/business-control-inputs/README.md` to map custom client templates.
- **SQLite Concurrency**: Best suited for local single-shop usage. Scale to PostgreSQL for multi-branch environments.
