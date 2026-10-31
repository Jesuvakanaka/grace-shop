import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import {
  createCashSale,
  createCreditSale,
  ensureImportedProducts,
  loginAs,
  saveEvidenceScreenshot,
} from './helpers/ui';

test.describe('End-of-Day Closing', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Save draft, close day, and verify lock state', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');
    await ensureImportedProducts(page);
    await createCashSale(page, 2);
    await createCreditSale(page, 3, 'Real File Debtor');

    await page.getByTestId('sidebar-daily-log').click();
    await page.getByRole('button', { name: /Record Expense/i }).click();
    await page.getByTestId('expense-category').selectOption('Logistics');
    await page.getByTestId('expense-amount').fill('150.00');
    await page.getByPlaceholder('Clear reason for expense').fill('Import customs clearance fee');
    await page.getByTestId('expense-submit').click();
    await expect(page.getByText('Expense recorded successfully!')).toBeVisible();

    await page.getByTestId('sidebar-cash').click();
    await page.getByTestId('cash-opening-cash').fill('1000');
    await page.getByTestId('cash-actual-input').fill('915.52');
    await page.getByTestId('cash-save-button').click();
    await expect(page.getByTestId('cash-save-button')).toContainText('Save Cash Position', { timeout: 20000 });
    await expect(page.getByTestId('cash-actual-counted')).toContainText('$915.52');

    await page.getByTestId('sidebar-closing').click();
    await expect(page.getByTestId('closing-form')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'closing-before');

    await page.getByTestId('closing-actual-cash').fill('910.52');
    await page.getByTestId('closing-signoff-name').fill('Business Owner');
    await page.getByTestId('closing-save-draft').click();
    await expect(page.getByText('Closing draft saved successfully!')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'closing-draft-saved');

    await page.getByTestId('closing-close-button').click();
    await expect(page.getByText('Day closing locked and finalized!')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('closing-status')).toContainText('CLOSED', { timeout: 20000 });
    await saveEvidenceScreenshot(page, testInfo, 'closing-closed');

    await expect(page.getByTestId('closing-actual-cash')).toBeDisabled();
    await expect(page.getByText('Day is closed and transaction editing is locked.')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'closing-edit-blocked');
  });
});
