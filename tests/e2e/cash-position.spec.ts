import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import {
  createCashSale,
  ensureImportedProducts,
  loginAs,
  saveEvidenceScreenshot,
} from './helpers/ui';

test.describe('Cash Position Tracker', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Expected closing and variance calculations update from counted cash', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');
    await ensureImportedProducts(page);
    await createCashSale(page, 2);

    await page.getByTestId('sidebar-cash').click();
    await expect(page.locator('main h1')).toContainText('Cash Position Tracker');
    await expect(page.locator('span', { hasText: 'Opening Cash (USD)' }).first()).toBeVisible();
    await expect(page.locator('span', { hasText: 'Cash Sales (USD)' }).first()).toBeVisible();
    await expect(page.locator('span', { hasText: 'Debtor Payments Received (USD)' }).first()).toBeVisible();
    await expect(page.locator('span', { hasText: 'Other Cash In (USD)' }).first()).toBeVisible();
    await expect(page.locator('span', { hasText: 'Expenses Paid (USD)' }).first()).toBeVisible();
    await expect(page.locator('span', { hasText: 'Creditor Payments Made (USD)' }).first()).toBeVisible();

    await page.getByTestId('cash-opening-cash').fill('1000');
    await page.getByTestId('cash-actual-input').fill('0');
    await page.getByTestId('cash-save-button').click();
    await expect(page.getByText('Cash position updated successfully!')).toBeVisible({ timeout: 20000 });

    const expectedText = await page.getByTestId('cash-expected-closing').innerText();
    const expectedValue = Number(expectedText.replace(/[^0-9.-]/g, ''));
    const actualTarget = (expectedValue - 5).toFixed(2);

    await page.getByTestId('cash-actual-input').fill(actualTarget);
    await page.getByTestId('cash-save-button').click();
    await expect(page.getByText('Cash position updated successfully!')).toBeVisible({ timeout: 20000 });

    const expectedActualDisplay = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(Number(actualTarget));

    await expect(page.getByTestId('cash-actual-counted')).toContainText(expectedActualDisplay);
    await expect(page.getByTestId('cash-variance')).toContainText('-$5.00');
    await saveEvidenceScreenshot(page, testInfo, 'cash-position-variance');
  });
});
