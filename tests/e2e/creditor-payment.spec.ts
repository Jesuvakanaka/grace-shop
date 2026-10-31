import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import { loginAs, saveEvidenceScreenshot } from './helpers/ui';

test.describe('Creditor Creation and Payment', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Creates Supplier Bob and records partial payment', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');

    await page.getByTestId('sidebar-creditors').click();
    await page.getByTestId('add-creditor-button').click();
    await page.getByTestId('creditor-form-name').fill('Supplier Bob');
    await page.getByTestId('creditor-form-owed').fill('200.00');
    await page.getByTestId('creditor-form-submit').click();
    await expect(page.getByText('Creditor account created successfully!')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'creditor-created');

    const creditorRow = page.locator('[data-testid="creditor-row"][data-creditor-name="Supplier Bob"]');
    await expect(creditorRow).toBeVisible();
    await expect(creditorRow.locator('[data-testid="creditor-row-balance"]')).toContainText('$200.00');

    await creditorRow.getByTestId('creditor-record-payment').click();
    await expect(page.getByTestId('creditor-payment-form')).toBeVisible();
    await page.getByTestId('creditor-payment-amount').fill('80.00');
    await page.getByTestId('creditor-payment-submit').click();
    await expect(page.getByText('Supplier payment recorded successfully!')).toBeVisible({ timeout: 20000 });

    await expect(creditorRow.locator('[data-testid="creditor-row-balance"]')).toContainText('$120.00');
    await expect(creditorRow).toContainText('PART_PAID');
    await saveEvidenceScreenshot(page, testInfo, 'creditor-after-payment');

    await page.getByTestId('sidebar-cash').click();
    await expect(page.getByText('Creditor Payments Made (USD)')).toBeVisible();
    await expect(page.getByTestId('cash-expected-closing')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'creditor-cash-update');
  });
});
