import { test, expect } from '@playwright/test';
import { resetDatabase } from './helpers/reset-db';
import { loginAs, saveEvidenceScreenshot } from './helpers/ui';

test.describe('Reports and Print Layouts', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test('Open each report and verify print-friendly layout markers', async ({ page }, testInfo) => {
    await loginAs(page, 'owner');

    await page.evaluate(() => {
      window.print = () => {
        (window as any).printCalled = true;
      };
    });

    await page.getByTestId('sidebar-reports').click();
    await expect(page.locator('main h1')).toContainText('Printable Reports Hub');
    await expect(page.getByTestId('reports-list')).toBeVisible();

    const reportTabs = ['products', 'sales', 'expenses', 'cash', 'debtors', 'creditors', 'ledger', 'closing'];
    for (const tab of reportTabs) {
      await page.getByTestId(`report-tab-${tab}`).click();
      await expect(page.getByTestId('report-printable-area')).toBeVisible();
      const printableH2 = page.locator('[data-testid="report-printable-area"] h2');
      const emptyState = page.getByText('No report details found');
      await expect(printableH2.or(emptyState).first()).toBeVisible();
      await saveEvidenceScreenshot(page, testInfo, `report-${tab}`);
    }

    await page.getByTestId('print-report-button').click();
    const printCalled = await page.evaluate(() => (window as any).printCalled);
    expect(printCalled).toBe(true);
  });
});
