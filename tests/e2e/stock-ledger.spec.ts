import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import {
  createCashSale,
  createCreditSale,
  ensureImportedProducts,
  loginAs,
  saveEvidenceScreenshot,
} from './helpers/ui';

test.describe('Stock Ledger', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Shows expected opening, sale movements, and closing for Item 1', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');
    await ensureImportedProducts(page);
    await createCashSale(page, 2);
    await createCreditSale(page, 3, 'Real File Debtor');

    await page.getByTestId('sidebar-stock-ledger').click();
    await expect(page.getByTestId('stock-ledger-table')).toBeVisible();

    const productValue = await page
      .locator('[data-testid="stock-ledger-select"] option', { hasText: '1 - Children' })
      .first()
      .getAttribute('value');
    if (!productValue) throw new Error('Could not find Item 1 stock-ledger option.');

    await page.getByTestId('stock-ledger-select').selectOption(productValue);

    const rows = page.getByTestId('stock-ledger-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('SALE');
    await expect(rows.first()).toContainText('-3');
    await expect(rows.nth(1)).toContainText('-2');
    await expect(rows.nth(2)).toContainText('OPENING BALANCE');
    await expect(rows.first()).toContainText('5');
    await saveEvidenceScreenshot(page, testInfo, 'stock-ledger-item1');
  });
});
