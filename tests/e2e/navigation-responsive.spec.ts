import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import { loginAs, saveEvidenceScreenshot } from './helpers/ui';

test.describe('Navigation and Responsive Layouts', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Desktop and mobile navigation with route health checks', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await loginAs(page, 'owner');

    const desktopNav: Array<{ testId: string; title: string; path: string }> = [
      { testId: 'sidebar-dashboard', title: 'Dashboard', path: '/' },
      { testId: 'sidebar-daily-log', title: 'Daily Operations Log', path: '/daily-log' },
      { testId: 'sidebar-products', title: 'Product / Stock Master', path: '/products' },
      { testId: 'sidebar-sales', title: 'Daily Sales Log', path: '/sales' },
      { testId: 'sidebar-expenses', title: 'Daily Expenses Log', path: '/expenses' },
      { testId: 'sidebar-cash', title: 'Cash Position Tracker', path: '/cash' },
      { testId: 'sidebar-debtors', title: 'Debtors Directory', path: '/debtors' },
      { testId: 'sidebar-creditors', title: 'Creditors Registry', path: '/creditors' },
      { testId: 'sidebar-stock-ledger', title: 'Stock Ledger Movement Log', path: '/stock-ledger' },
      { testId: 'sidebar-closing', title: 'End-of-Day Closing Ledger', path: '/closing' },
      { testId: 'sidebar-import', title: 'Import Data', path: '/import' },
      { testId: 'sidebar-reports', title: 'Printable Reports Hub', path: '/reports' },
      { testId: 'sidebar-exchange-rate', title: 'Exchange Rate Settings', path: '/settings/exchange-rate' },
    ];

    for (const item of desktopNav) {
      const link = page.getByTestId(item.testId);
      await link.scrollIntoViewIfNeeded();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${item.path.replace(/\//g, '\\/')}$`), { timeout: 15000 });
      await expect(page.locator('main h1')).toContainText(item.title);
    }
    await saveEvidenceScreenshot(page, testInfo, 'desktop-navigation');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByTestId('bottom-nav')).toBeVisible();
    await page.getByTestId('bottom-nav-more').click();
    await page.getByTestId('more-nav-daily-log').click();
    await expect(page.getByTestId('daily-log-sale-form')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'mobile-daily-log-usable');

    await page.getByTestId('bottom-nav-stock').click();
    await expect(page.getByTestId('product-table')).toBeVisible();
    await saveEvidenceScreenshot(page, testInfo, 'mobile-product-master-usable');
  });
});
