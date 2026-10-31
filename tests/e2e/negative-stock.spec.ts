import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import { loginAs, saveEvidenceScreenshot } from './helpers/ui';

test.describe('Negative Stock Prevention', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Prevents recording sales that exceed available stock', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');

    await page.getByTestId('sidebar-products').click();
    await expect(page).toHaveURL(/\/products/, { timeout: 15000 });
    await expect(page.getByTestId('product-table')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('add-product').click();
    await page.getByTestId('product-form-item-number').fill('TST-001');
    await page.getByTestId('product-form-name').fill('Test Low Stock Product');
    await page.getByTestId('product-form-cost-rmb').fill('10');
    await page.getByTestId('product-form-cost-usd').fill('1.5');
    await page.getByTestId('product-form-opening-qty').fill('2');
    await page.getByTestId('product-form-submit').click();
    await expect(page.locator('[data-testid="product-row"][data-item-number="TST-001"]')).toBeVisible();

    await page.getByTestId('sidebar-daily-log').click();
    await page.getByTestId('sale-product-select').selectOption({ label: 'TST-001 - Test Low Stock Product (Stock: 2)' });
    await page.getByTestId('sale-quantity-input').fill('5');
    await page.getByTestId('sale-submit').click();

    await expect(page.getByText('Insufficient stock')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'negative-stock-error');

    await page.getByTestId('sidebar-products').click();
    await expect(page).toHaveURL(/\/products/, { timeout: 15000 });
    await expect(page.locator('[data-testid="product-row"][data-item-number="TST-001"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-testid="product-row"][data-item-number="TST-001"] [data-testid="product-current-stock"]')).toContainText('2', { timeout: 20000 });
    await saveEvidenceScreenshot(page, testInfo, 'negative-stock-unchanged');

    await page.getByTestId('sidebar-sales').click();
    await expect(page.getByText('TST-001')).toHaveCount(0);
  });
});
