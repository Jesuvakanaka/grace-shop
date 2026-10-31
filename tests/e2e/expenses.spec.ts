import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import {
  ensureImportedProducts,
  loginAs,
  saveEvidenceScreenshot,
} from './helpers/ui';

test.describe('Expenses', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Records logistics expense and updates logs and cash', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');
    await ensureImportedProducts(page);

    await page.getByTestId('sidebar-daily-log').click();
    await page.getByRole('button', { name: /Record Expense/i }).click();
    await page.getByTestId('expense-category').selectOption('Logistics');
    await page.getByTestId('expense-amount').fill('150.00');
    await page.getByPlaceholder('Vendor or recipient').fill('Port Authority');
    await page.getByPlaceholder('Clear reason for expense').fill('Import customs clearance fee');
    await saveEvidenceScreenshot(page, testInfo, 'expense-form-filled');
    await page.getByTestId('expense-submit').click();
    await expect(page.getByText('Expense recorded successfully!')).toBeVisible({ timeout: 20000 });

    await page.getByTestId('sidebar-expenses').click();
    await expect(page.getByTestId('expense-row').first()).toContainText('Logistics');
    await expect(page.getByTestId('expense-row').first()).toContainText('Port Authority');
    await expect(page.getByTestId('expense-row-amount').first()).toContainText('$150.00');
    await saveEvidenceScreenshot(page, testInfo, 'expense-log-row');

    await page.getByTestId('sidebar-cash').click();
    await expect(page.getByText('Expenses Paid (USD)')).toBeVisible();
    await expect(page.getByTestId('cash-expected-closing')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'expense-cash-position');
  });
});
