import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import {
  createCashSale,
  createCreditSale,
  ensureImportedProducts,
  loginAs,
  saveEvidenceScreenshot,
} from './helpers/ui';

test.describe('Daily Log - Credit Sale and Debtor', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Records credit sale and debtor outstanding with required validation', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');
    await ensureImportedProducts(page);

    await createCashSale(page, 2);
    await page.getByRole('button', { name: /Record Expense/i }).click();
    await page.getByRole('button', { name: /Record Sale/i }).click();

    await page.getByTestId('sidebar-daily-log').click();
    const productValue = await page
      .locator('[data-testid="sale-product-select"] option', { hasText: '1 - Children' })
      .first()
      .getAttribute('value');
    if (!productValue) throw new Error('Could not find Item 1 option.');

    await page.getByTestId('sale-product-select').selectOption(productValue);
    await page.getByTestId('sale-quantity-input').fill('3');
    await page.getByTestId('sale-payment-type').selectOption('CREDIT');
    await page.getByTestId('sale-submit').click();
    await expect(page.getByTestId('sale-customer-name')).toBeVisible();
    await expect(page.getByTestId('sale-customer-name')).toBeFocused();
    await expect(page.getByText('Sale recorded successfully!')).toHaveCount(0);
    await saveEvidenceScreenshot(page, testInfo, 'credit-sale-missing-customer-validation');

    await createCreditSale(page, 3, 'Real File Debtor');
    await saveEvidenceScreenshot(page, testInfo, 'credit-sale-form-submitted');

    await page.getByTestId('sidebar-products').click();
    const item1StockAfter = page.locator('[data-testid="product-row"][data-item-number="1"] [data-testid="product-current-stock"]');
    await expect(item1StockAfter).toContainText('5');
    await saveEvidenceScreenshot(page, testInfo, 'credit-sale-stock-after');

    await page.getByTestId('sidebar-debtors').click();
    const debtorRow = page.locator('[data-testid="debtor-row"][data-customer-name="Real File Debtor"]');
    await expect(debtorRow).toBeVisible();
    await expect(debtorRow).toContainText('OPEN');
    await expect(debtorRow.locator('[data-testid="debtor-row-balance"]')).toContainText('$48.78');
    await saveEvidenceScreenshot(page, testInfo, 'credit-sale-debtor-open');
  });
});
