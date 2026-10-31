# Owner UAT Script — Business Control MVP

This script allows the business owner to verify that all business control modules operate correctly and match paper processes.

---

## Testing Instructions
1. Run the local development server (`npm run dev`) or access the production build.
2. Sign in as `owner`. The UAT `owner` and `staff` passwords are provided separately (held in Secret Manager); they are not written in this script or shown on the login page. Local development only falls back to `owner123` / `staff123`.
3. Follow the steps sequentially and mark **Pass / Fail**.

---

| Step | Section | Action | Expected Result | Pass / Fail | Notes |
|---|---|---|---|---|---|
| **1** | Auth | Log in as `staff` (password provided separately) | - Logged in successfully<br>- Cannot see 'Import Data' or 'Exchange Rate Settings' links | | |
| **2** | Auth | Log out and log in as `owner` (password provided separately) | - Logged in successfully<br>- Can see all pages | | |
| **3** | Exchange Rate | Navigate to `Settings -> Exchange Rate Settings` and set RMB to USD rate to `0.14` | - New exchange rate saved successfully<br>- History table shows the new rate | | |
| **4** | Import | Navigate to `Import Data`, upload `business_product_list_with_selling_prices.xlsx` (scaffold preview) | - Excel parsed successfully<br>- Detected type: PRODUCT_LIST<br>- Show preview table with Status: READY / WARNING / ERROR | | |
| **5** | Import | Confirm the import preview | - Records written to database<br>- Navigation redirects to Product Master showing imported rows | | |
| **6** | Product Master | Check prices on imported products | - Selling Price RMB = 2 × Unit Cost RMB<br>- Unit Cost USD = Unit Cost RMB × 0.14 (if USD was blank)<br>- Selling Price USD = 2 × Unit Cost USD | | |
| **7** | Import | Navigate to `Import Data`, upload `stock_tracking_workbook.xlsx` (scaffold preview) | - Detected type: OPENING_STOCK<br>- Previews opening quantities correctly | | |
| **8** | Import | Confirm opening stock import | - Product master shows updated stock quantities<br>- Stock Movements show OPENING_BALANCE records | | |
| **9** | Daily Log | Navigate to `Daily Log` and record a Cash Sale: 2 units of product `P001` at its selling price | - Stock count for `P001` decreases by 2 units<br>- Cash Position: 'Cash Sales' increases by sale total<br>- Expected cash increases | | |
| **10** | Daily Log | Record a Credit Sale: 3 units of `P001` to `Real File Debtor` | - Stock count decreases by 3 units<br>- Debtor balance for `Real File Debtor` increases by sale total<br>- Debtor status set to OPEN | | |
| **11** | Daily Log | Attempt to sell more than current stock | - Warning displayed or block occurred<br>- Sale is rejected to prevent negative stock | | |
| **12** | Daily Log | Record a cash Expense: Category: `Food`, Amount: `20`, Description: `Staff lunch` | - Expense saved successfully<br>- Cash Position: 'Expenses Paid' increases by 20<br>- Expected Cash decreases by 20 | | |
| **13** | Daily Log | Record a Debtor Payment: `Real File Debtor` pays `10` USD cash | - Real File Debtor's outstanding balance decreases by 10<br>- Real File Debtor's status changes to PART_PAID<br>- Cash Position: 'Debtor Payments Received' increases by 10<br>- Expected cash increases | | |
| **14** | Daily Log | Record a Creditor Payment: Create `Supplier Bob` owing `200`, pay `50` USD cash | - Creditor balance decreases to 150<br>- Cash Position: 'Creditor Payments Made' increases by 50<br>- Expected cash decreases | | |
| **15** | Dashboard | Navigate to `Dashboard` and verify figures | - Stock quantity on hand, cost value, potential sales value match database<br>- Today's Sales, Expenses, Expected Cash, Debtors, Creditors match daily actions | | |
| **16** | Stock Ledger | Navigate to `Stock Ledger` for product `P001` | - Ledger shows Opening Balance, Sold quantity, Closing balance correctly following the formula | | |
| **17** | Day Closing | Navigate to `Day Closing`, select today's date | - Summary shows cash sales, debtor payments, expenses, expected cash in hand | | |
| **18** | Day Closing | Enter Actual Counted Cash, input Sign-off Name `Business Owner`, save draft | - Draft closing saved successfully<br>- Cash Variance calculated correctly | | |
| **19** | Day Closing | Click 'Close Day' | - Day closing status set to CLOSED<br>- Fields lock and cannot be edited without admin bypass | | |
| **20** | Reports | Navigate to `Reports` and print 'Daily log' or 'End-of-day closing' | - Opens browser print preview<br>- Styling matches paper layout (clean white bg, no navigation sidebar, visible tables) | | |

---

## Verdict Summary
- **Tested By**: __________________________
- **Date**: __________________________
- **Total Steps Passed**: ____ / 20
- **Final UAT Status**: [ ] APPROVED   [ ] REJECTED   [ ] APPROVED WITH GAPS
