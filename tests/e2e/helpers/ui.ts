import { expect, Page, TestInfo } from '@playwright/test';
import path from 'path';
import fs from 'fs';

export const REAL_PRODUCT_FILE = path.resolve(
  'docs/business-control-inputs/business_product_list_with_selling_prices.xlsx'
);

export async function saveEvidenceScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

export function assertRealProductFileExists() {
  if (!fs.existsSync(REAL_PRODUCT_FILE)) {
    throw new Error(
      'Real product list file missing. Place business_product_list_with_selling_prices.xlsx in docs/business-control-inputs/ for acceptance validation.'
    );
  }
}

export async function loginAs(page: Page, role: 'owner' | 'staff') {
  await page.goto('/');
  const loginInput = page.getByTestId('login-username');
  const needsLogin = await loginInput
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (needsLogin) {
    await loginInput.fill(role);
    await page.getByTestId('login-password').fill(role === 'owner' ? 'owner123' : 'staff123');
    await page.getByTestId('login-submit').click();
  }
  try {
    const nav = page.getByTestId('sidebar-dashboard').or(page.getByTestId('bottom-nav'));
    await expect(nav.first()).toBeVisible({ timeout: 20000 });
  } catch {
    const loginError = await page.locator('.text-rose-400').first().textContent().catch(() => null);
    if (loginError && loginError.trim()) {
      throw new Error(`Login failed for ${role}: ${loginError.trim()}`);
    }
    throw new Error(`Login did not complete for ${role}: sidebar did not become visible.`);
  }
}

export async function logout(page: Page) {
  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('login-username')).toBeVisible();
}

export async function goSidebar(page: Page, testId: string) {
  const desktop = page.getByTestId(testId);
  if (await desktop.isVisible().catch(() => false)) {
    await desktop.click();
    return;
  }

  const bottomTab: Record<string, string> = {
    'sidebar-dashboard': 'bottom-nav-home',
    'sidebar-products': 'bottom-nav-stock',
  };
  const moneyRoutes: Record<string, string> = {
    'sidebar-cash': 'cash',
    'sidebar-debtors': 'debtors',
    'sidebar-creditors': 'creditors',
    'sidebar-expenses': 'expenses',
  };

  if (bottomTab[testId]) {
    await page.getByTestId(bottomTab[testId]).click();
    return;
  }

  if (moneyRoutes[testId]) {
    await page.getByTestId('bottom-nav-money').click();
    if (testId !== 'sidebar-cash') {
      await page.getByTestId(`money-nav-${moneyRoutes[testId]}`).click();
    }
    return;
  }

  await page.getByTestId('bottom-nav-more').click();
  const moreNavId = testId.replace(/^sidebar-/, 'more-nav-');
  await page.getByTestId(moreNavId).click();
}

export async function importRealProductFile(page: Page, exchangeRate = '0.1478') {
  assertRealProductFileExists();

  await goSidebar(page, 'sidebar-import');
  await expect(page.locator('main h1')).toContainText('Import Data');

  await page.locator('input[type="file"]').setInputFiles(REAL_PRODUCT_FILE);

  await expect(page.getByText('Uploading and validating sheet rows...')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Uploading and validating sheet rows...')).toHaveCount(0, { timeout: 90000 });
  await expect(page.getByTestId('import-document-type')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('import-preview-table')).toBeVisible();
  await expect(page.getByTestId('import-total-rows')).toHaveText('49');
  await expect(page.getByTestId('import-error-rows')).toHaveText('1');

  const readyRows = Number((await page.getByTestId('import-ready-rows').innerText()).trim());
  const warningRows = Number((await page.getByTestId('import-warning-rows').innerText()).trim());
  expect(readyRows + warningRows).toBe(48);

  await page.getByTestId('exchange-rate-input').fill(exchangeRate);
  await page.getByTestId('import-confirm-button').click();

  await expect(page.getByText('Import completed!')).toBeVisible({ timeout: 180000 });
  await page.goto('/import/history');
  await expect(page.getByTestId('import-history-table')).toBeVisible();
}

export async function ensureImportedProducts(page: Page) {
  await goSidebar(page, 'sidebar-products');
  await expect(page).toHaveURL(/\/products/, { timeout: 15000 });
  await expect(page.getByTestId('product-table')).toBeVisible({ timeout: 20000 });
  const rows = page.getByTestId('product-row');
  const rowCount = await rows.count();
  if (rowCount === 0) {
    await importRealProductFile(page);
    await goSidebar(page, 'sidebar-products');
    await expect(page).toHaveURL(/\/products/, { timeout: 15000 });
    await expect(page.getByTestId('product-row')).toHaveCount(48);
  }
}

export async function createCashSale(page: Page, quantity: number) {
  await goSidebar(page, 'sidebar-daily-log');
  await expect(page.locator('main h1')).toContainText('Daily Operations Log');
  const productValue = await page.locator('[data-testid="sale-product-select"] option', { hasText: '1 - Children' }).first().getAttribute('value');
  if (!productValue) throw new Error('Could not find Item 1 product option in daily log selector.');
  await page.getByTestId('sale-product-select').selectOption(productValue);
  await page.getByTestId('sale-quantity-input').fill(String(quantity));
  await page.getByTestId('sale-payment-type').selectOption('CASH');
  await page.getByTestId('sale-submit').click();
  await expect(page.getByText('Sale recorded successfully!')).toBeVisible({ timeout: 20000 });
}

export async function createCreditSale(page: Page, quantity: number, customer = 'Real File Debtor') {
  await goSidebar(page, 'sidebar-daily-log');
  await expect(page.locator('main h1')).toContainText('Daily Operations Log');
  const productValue = await page.locator('[data-testid="sale-product-select"] option', { hasText: '1 - Children' }).first().getAttribute('value');
  if (!productValue) throw new Error('Could not find Item 1 product option in daily log selector.');
  await page.getByTestId('sale-product-select').selectOption(productValue);
  await page.getByTestId('sale-quantity-input').fill(String(quantity));
  await page.getByTestId('sale-payment-type').selectOption('CREDIT');
  await page.getByTestId('sale-customer-name').fill(customer);
  await page.getByTestId('sale-submit').click();
  await expect(page.getByText('Sale recorded successfully!')).toBeVisible({ timeout: 20000 });
}
