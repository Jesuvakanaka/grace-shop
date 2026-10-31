import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import {
  createCashSale,
  ensureImportedProducts,
  loginAs,
  saveEvidenceScreenshot,
} from './helpers/ui';

test.describe('Daily Log - Cash Sale', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Records cash sale and updates stock, sales log, and dashboard', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');
    await ensureImportedProducts(page);

    const item1StockBefore = page.locator('[data-testid="product-row"][data-item-number="1"] [data-testid="product-current-stock"]');
    await expect(item1StockBefore).toContainText('10');
    await saveEvidenceScreenshot(page, testInfo, 'cash-sale-before-stock');

    await createCashSale(page, 2);

    await page.getByTestId('sidebar-products').click();
    const item1StockAfter = page.locator('[data-testid="product-row"][data-item-number="1"] [data-testid="product-current-stock"]');
    await expect(item1StockAfter).toContainText('8');
    await saveEvidenceScreenshot(page, testInfo, 'cash-sale-after-stock');

    await page.getByTestId('sidebar-sales').click();
    await expect(page.getByTestId('sales-log-row').first()).toContainText('CASH');
    await expect(page.getByTestId('sales-log-row-total').first()).toContainText('$32.52');
    await saveEvidenceScreenshot(page, testInfo, 'cash-sale-sales-log-row');

    await page.getByTestId('sidebar-dashboard').click();
    await expect(page.getByTestId('dashboard-kpi-todays-sales')).toContainText('$32.52');
    await saveEvidenceScreenshot(page, testInfo, 'cash-sale-dashboard-sales');
  });
});
