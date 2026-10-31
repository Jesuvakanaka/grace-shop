import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import {
  createCashSale,
  createCreditSale,
  ensureImportedProducts,
  loginAs,
  saveEvidenceScreenshot,
} from './helpers/ui';

test.describe('Dashboard End-to-End Summary', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Dashboard KPIs reflect imported stock and daily workflow outcomes', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');
    await ensureImportedProducts(page);

    await createCashSale(page, 2);
    await createCreditSale(page, 3, 'Real File Debtor');

    await page.getByTestId('sidebar-debtors').click();
    const debtorRow = page.locator('[data-testid="debtor-row"][data-customer-name="Real File Debtor"]');
    await debtorRow.getByTestId('debtor-record-payment').click();
    await page.getByTestId('debtor-payment-amount').fill('10.00');
    await page.getByTestId('debtor-payment-submit').click();
    await expect(page.getByText('Payment recorded successfully!')).toBeVisible({ timeout: 20000 });

    await page.getByTestId('sidebar-daily-log').click();
    await page.getByRole('button', { name: /Record Expense/i }).click();
    await page.getByTestId('expense-category').selectOption('Logistics');
    await page.getByTestId('expense-amount').fill('150.00');
    await page.getByPlaceholder('Clear reason for expense').fill('Import customs clearance fee');
    await page.getByTestId('expense-submit').click();

    await page.getByTestId('sidebar-creditors').click();
    await page.getByTestId('add-creditor-button').click();
    await page.getByTestId('creditor-form-name').fill('Supplier Bob');
    await page.getByTestId('creditor-form-owed').fill('200.00');
    await page.getByTestId('creditor-form-submit').click();
    const creditorRow = page.locator('[data-testid="creditor-row"][data-creditor-name="Supplier Bob"]');
    await creditorRow.getByTestId('creditor-record-payment').click();
    await page.getByTestId('creditor-payment-amount').fill('80.00');
    await page.getByTestId('creditor-payment-submit').click();

    await page.getByTestId('sidebar-cash').click();
    await page.getByTestId('cash-opening-cash').fill('1000');
    await page.getByTestId('cash-actual-input').fill('0');
    await page.getByTestId('cash-save-button').click();
    await expect(page.getByText('Cash position updated successfully!')).toBeVisible({ timeout: 20000 });
    const expectedCashText = (await page.getByTestId('cash-expected-closing').innerText()).trim();
    const expectedCashValue = Number(expectedCashText.replace(/[^0-9.-]/g, ''));
    const actualCashTarget = (expectedCashValue - 5).toFixed(2);
    await page.getByTestId('cash-actual-input').fill(actualCashTarget);
    await page.getByTestId('cash-save-button').click();
    await expect(page.getByText('Cash position updated successfully!')).toBeVisible({ timeout: 20000 });

    await page.getByTestId('sidebar-dashboard').click();
    await expect(page.getByTestId('dashboard-kpi-total-stock')).toContainText('1039');
    await expect(page.getByTestId('dashboard-kpi-todays-sales')).toContainText('$81.30');
    await expect(page.getByTestId('dashboard-kpi-expenses')).toContainText('$150.00');
    await expect(page.getByTestId('dashboard-kpi-expected-cash')).toContainText(expectedCashText);
    await expect(page.getByTestId('dashboard-kpi-cash-variance')).toContainText('-$5.00');
    await expect(page.getByTestId('dashboard-kpi-debtors')).toContainText('$38.78');
    await expect(page.getByTestId('dashboard-kpi-creditors')).toContainText('$120.00');
    await expect(page.getByTestId('dashboard-kpi-total-stock-value')).toBeVisible();
    await expect(page.getByTestId('dashboard-kpi-potential-sales')).toBeVisible();
    await expect(page.getByTestId('dashboard-kpi-gross-profit')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'dashboard-final-summary');
  });
});
