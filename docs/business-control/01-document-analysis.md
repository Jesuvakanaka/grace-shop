# Document Analysis — Business Control MVP

## 1. Input Documents Reviewed

| # | Document | Type | Status |
|---|---|---|---|
| 1 | business_product_list_with_selling_prices.xlsx | Excel | **TODO: Not yet available** |
| 2 | business_product_list_with_selling_prices.pdf | PDF | **TODO: Not yet available** |
| 3 | stock_tracking_workbook.xlsx | Excel | **TODO: Not yet available** |
| 4 | stock_tracking_printable_pages.pdf | PDF | **TODO: Not yet available** |
| 5 | business_stock_cash_credit_control_tracker.xlsx | Excel | **TODO: Not yet available** |
| 6 | daily_cash_credit_stock_log_printable.pdf | PDF | **TODO: Not yet available** |

> **TODO**: Real source files must be placed in `docs/business-control-inputs/` and the import service must be tested against them before acceptance.

## 2. Extracted Forms / Pages (from specification)

### Product List
- Item number, Product name, Unit cost (RMB/USD), Selling price (RMB/USD), Quantity
- Branded goods column exists but must be **ignored**
- Selling price = 2 × purchase price

### Stock Tracking Workbook
- Per-product tracking: Opening balance, Received, Sold, Returns, Adjustments, Closing balance
- Closing = Opening + Received + Returns + Adjustments − Sold

### Daily Cash/Credit/Stock Log
- Sales section: Product, Qty, Price, Cash/Credit, Customer
- Expenses section: Category, Description, Amount
- Cash position: Opening → Closing with formula
- Debtors/Creditors tracking

## 3. Field Mapping: Document → Web Screen

### Product List → Product / Stock Master Screen

| Document Field | Web Field | Database Column |
|---|---|---|
| Item No | Item Number | products.itemNumber |
| Product Name | Product Name | products.productName |
| Unit Cost RMB | Unit Cost (RMB) | products.unitCostRmb |
| Unit Cost USD | Unit Cost (USD) | products.unitCostUsd |
| Selling Price RMB | Selling Price (RMB) | products.sellingPriceRmb |
| Selling Price USD | Selling Price (USD) | products.sellingPriceUsd |
| Opening Qty | Opening Quantity | products.openingQuantity |
| Current Stock | Current Stock | products.currentQuantity |
| Branded | **IGNORED** | — |

### Daily Log → Daily Sales Log Screen

| Document Field | Web Field | Database Column |
|---|---|---|
| Date | Date | sales.saleDate |
| Product | Product | saleItems.productId |
| Qty | Quantity Sold | saleItems.quantity |
| Price | Unit Selling Price | saleItems.unitPrice |
| Total | Total Sale Amount | saleItems.totalAmount |
| Cash/Credit | Payment Type | sales.paymentType |
| Customer | Customer Name | sales.customerName |

### Daily Log → Expenses Screen

| Document Field | Web Field | Database Column |
|---|---|---|
| Date | Date | expenses.expenseDate |
| Category | Category | expenses.category |
| Description | Description | expenses.description |
| Amount | Amount | expenses.amount |
| Paid to | Paid To | expenses.paidTo |

### Daily Log → Cash Position Screen

| Document Field | Web Field | Database Column |
|---|---|---|
| Opening Cash | Opening Cash | cashPositions.openingCash |
| Cash Sales | Cash Sales | cashPositions.cashSales |
| Debtor Payments | Debtor Payments Received | cashPositions.debtorPaymentsReceived |
| Other Cash In | Other Cash In | cashPositions.otherCashIn |
| Expenses Paid | Expenses Paid | cashPositions.expensesPaid |
| Creditor Payments | Creditor Payments Made | cashPositions.creditorPaymentsMade |
| Expected Cash | Expected Closing Cash | cashPositions.expectedClosingCash |
| Actual Cash | Actual Counted Cash | cashPositions.actualCountedCash |
| Difference | Variance | cashPositions.variance |

## 4. Calculations Found

| Calculation | Formula |
|---|---|
| Selling Price | 2 × Purchase Price |
| Expected Closing Cash | Opening + Cash Sales + Debtor Payments + Other In − Expenses − Creditor Payments |
| Cash Variance | Actual Counted − Expected Closing |
| Stock Closing Balance | Opening + Received + Returns + Adjustments − Sold |
| Debtor Outstanding | Total Credit − Total Paid |
| Creditor Outstanding | Total Owed − Total Paid |
| Estimated Gross Profit | Total Potential Sales Value − Total Stock Cost Value |

## 5. Assumptions

1. USD is the primary operating currency for cash, sales, expenses, debtors, creditors
2. RMB is used for purchase cost tracking only
3. Exchange rate is configurable and used when USD prices are missing
4. No barcode, fiscal, receipt printer, or multi-branch features
5. Single shop, multiple users (Owner + Staff roles)
6. SQLite for MVP, Postgres-ready for future
7. Product list import is the primary data entry method
8. Manual entry is always available as fallback

## 6. Unclear Areas

1. **Exact Excel column names** — Will be confirmed when actual files are provided
2. **Exchange rate source** — Manual entry only for MVP
3. **Multi-currency cash tracking** — Spec says USD only for cash book
4. **Tax handling** — Not in MVP scope
5. **Product categories** — Not mentioned, not included

## 7. Recommended MVP Scope

Build exactly what's specified — no more, no less:
- Product/Stock Master with import
- Daily Log, Sales, Expenses
- Cash Position, Debtors, Creditors
- Stock Ledger, End-of-Day Closing
- Printable Reports
- Simple auth (Owner/Staff)
- Exchange rate settings
