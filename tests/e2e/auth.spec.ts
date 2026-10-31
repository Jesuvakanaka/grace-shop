import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import { loginAs, logout, saveEvidenceScreenshot } from './helpers/ui';

test.describe('Authentication and role access', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Staff and owner permissions plus logout and unauthenticated redirect', async ({ page }, testInfo) => {
    await page.goto('/products');
    await expect(page.getByTestId('login-username')).toBeVisible();

    await loginAs(page, 'staff');
    await saveEvidenceScreenshot(page, testInfo, 'staff-login-dashboard');

    await expect(page.getByTestId('sidebar-daily-log')).toBeVisible();
    await expect(page.getByTestId('sidebar-products')).toBeVisible();
    await expect(page.getByTestId('sidebar-import')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-exchange-rate')).toHaveCount(0);
    await saveEvidenceScreenshot(page, testInfo, 'staff-restricted-navigation');

    await page.getByTestId('sidebar-products').click();
    await expect(page.getByTestId('add-product')).toHaveCount(0);

    await logout(page);

    await loginAs(page, 'owner');
    await expect(page.getByTestId('sidebar-import')).toBeVisible();
    await expect(page.getByTestId('sidebar-exchange-rate')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'owner-login-dashboard');

    await logout(page);
    await page.goto('/cash');
    await expect(page.getByTestId('login-username')).toBeVisible();
  });
});
