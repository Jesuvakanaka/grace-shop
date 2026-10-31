import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import { assertRealProductFileExists, loginAs, saveEvidenceScreenshot, REAL_PRODUCT_FILE } from './helpers/ui';

test.describe('Real-File Import Validation', () => {
  test.beforeEach(async () => {
    await resetDatabase();
    assertRealProductFileExists();
  });

  test('Upload real product list and verify import preview plus history', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');
    await page.getByTestId('sidebar-import').click();
    await expect(page.locator('main h1')).toContainText('Import Data');

    await page.locator('input[type="file"]').setInputFiles(REAL_PRODUCT_FILE);
    await saveEvidenceScreenshot(page, testInfo, 'real-import-upload-screen');

    await expect(page.getByText('Uploading and validating sheet rows...')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Uploading and validating sheet rows...')).toHaveCount(0, { timeout: 90000 });
    await expect(page.getByTestId('import-document-type')).toContainText('PRODUCT', { timeout: 30000 });
    await expect(page.getByTestId('import-preview-table')).toBeVisible();
    await expect(page.getByTestId('import-total-rows')).toHaveText('49');
    await expect(page.getByTestId('import-error-rows')).toHaveText('1');

    const readyRows = Number((await page.getByTestId('import-ready-rows').innerText()).trim());
    const warningRows = Number((await page.getByTestId('import-warning-rows').innerText()).trim());
    expect(readyRows + warningRows).toBe(48);
    await saveEvidenceScreenshot(page, testInfo, 'real-import-preview-table');

    await page.locator('[data-testid="import-preview-row"][data-row-number="50"]').click();
    await expect(page.getByText('Item number is required and cannot be empty.')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'real-import-total-row-rejected');

    await page.getByTestId('exchange-rate-input').fill('0.1478');
    await page.getByTestId('import-confirm-button').click();
    await expect(page.getByText('Import completed!')).toBeVisible({ timeout: 120000 });
    await page.goto('/import/history');
    await expect(page.getByTestId('import-history-table')).toBeVisible();
    await expect(page.getByTestId('import-history-row').first()).toContainText('business_product_list_with_selling_prices.xlsx');
    await expect(page.getByTestId('import-history-row').first()).toContainText('COMPLETED');
    await saveEvidenceScreenshot(page, testInfo, 'real-import-history');

    await page.getByTestId('sidebar-products').click();
    await expect(page.getByTestId('product-row')).toHaveCount(48);
    await saveEvidenceScreenshot(page, testInfo, 'real-import-product-master-48-products');
  });
});
