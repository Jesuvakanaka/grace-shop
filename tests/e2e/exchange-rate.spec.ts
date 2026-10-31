import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import { loginAs, logout, saveEvidenceScreenshot } from './helpers/ui';

test.describe('Exchange Rate Settings', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Owner can save rate and staff cannot update', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');
    await page.getByTestId('sidebar-exchange-rate').click();
    await expect(page.locator('main h1')).toContainText('Exchange Rate Settings');

    await page.getByTestId('exchange-rate-input').fill('0.1478');
    await page.getByTestId('exchange-rate-save').click();
    await expect(page.getByText('Exchange rate updated successfully!')).toBeVisible();
    await expect(page.getByTestId('exchange-rate-history-row').first()).toContainText('0.1478');
    await saveEvidenceScreenshot(page, testInfo, 'exchange-rate-saved');

    await logout(page);
    await loginAs(page, 'staff');
    await page.goto('/settings/exchange-rate');
    await expect(page.getByTestId('exchange-rate-input')).toBeDisabled();
    await expect(page.getByTestId('exchange-rate-save')).toHaveCount(0);
  });
});
