import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import {
  createCashSale,
  createCreditSale,
  ensureImportedProducts,
  loginAs,
  saveEvidenceScreenshot,
} from './helpers/ui';

test.describe('Debtor Payment using Real File Debtor', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Partial debtor payment updates debtor status and cash position', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');
    await ensureImportedProducts(page);
    await createCashSale(page, 2);
    await createCreditSale(page, 3, 'Real File Debtor');

    await page.getByTestId('sidebar-debtors').click();
    const debtorRow = page.locator('[data-testid="debtor-row"][data-customer-name="Real File Debtor"]');
    await expect(debtorRow).toBeVisible();
    await expect(debtorRow.locator('[data-testid="debtor-row-balance"]')).toContainText('$48.78');
    await saveEvidenceScreenshot(page, testInfo, 'debtor-before-payment');

    await debtorRow.getByTestId('debtor-record-payment').click();
    await expect(page.getByTestId('debtor-payment-form')).toBeVisible();
    await page.getByTestId('debtor-payment-amount').fill('10.00');
    await saveEvidenceScreenshot(page, testInfo, 'debtor-payment-form');
    await page.getByTestId('debtor-payment-submit').click();
    await expect(page.getByText('Payment recorded successfully!')).toBeVisible({ timeout: 20000 });

    await expect(debtorRow.locator('[data-testid="debtor-row-balance"]')).toContainText('$38.78');
    await expect(debtorRow).toContainText('PART_PAID');
    await saveEvidenceScreenshot(page, testInfo, 'debtor-after-payment');

    await page.getByTestId('sidebar-cash').click();
    await expect(page.getByText('Debtor Payments Received (USD)')).toBeVisible();
    await expect(page.getByTestId('cash-expected-closing')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'debtor-payment-cash-update');

    await page.getByTestId('sidebar-dashboard').click();
    await expect(page.getByTestId('dashboard-kpi-debtors')).toContainText('$38.78');
  });
});
