import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import { ensureImportedProducts, loginAs, saveEvidenceScreenshot } from './helpers/ui';

test.describe('Product Master and Pricing', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Imported products, pricing verification, manual create, duplicate warning', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');
    await ensureImportedProducts(page);

    await expect(page.getByTestId('product-row')).toHaveCount(48);
    await expect(page.getByTestId('product-table')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'products-master-table');

    const item1 = page.locator('[data-testid="product-row"][data-item-number="1"]');
    await expect(item1).toContainText('Children');
    await expect(item1.locator('td').nth(2)).toContainText('55');
    await expect(item1.locator('td').nth(4)).toContainText('110');
    await expect(item1.locator('td').nth(3)).toContainText('$8.13');
    await expect(item1.locator('td').nth(5)).toContainText('$16.26');
    await saveEvidenceScreenshot(page, testInfo, 'products-item1-pricing');

    await page.getByTestId('add-product').click();
    await page.getByTestId('product-form-item-number').fill('MAN-001');
    await page.getByTestId('product-form-name').fill('Manual Product 001');
    await page.getByTestId('product-form-cost-rmb').fill('40');
    await page.getByTestId('product-form-cost-usd').fill('5.91');
    await page.getByTestId('product-form-opening-qty').fill('4');
    await page.getByTestId('product-form-submit').click();
    await expect(page.locator('[data-testid="product-row"][data-item-number="MAN-001"]')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'products-manual-create');

    await page.getByTestId('add-product').click();
    await page.getByTestId('product-form-item-number').fill('MAN-001');
    await page.getByTestId('product-form-name').fill('Duplicate Product');
    await page.getByTestId('product-form-cost-rmb').fill('10');
    await page.getByTestId('product-form-opening-qty').fill('1');
    await page.getByTestId('product-form-submit').click();
    await expect(page.getByText('already exists')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'products-duplicate-warning');
  });
});
