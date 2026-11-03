import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const API_ORIGIN = 'http://localhost:3000';

test('the Overview shows the API status and the seeded dev user', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('API status: ok')).toBeVisible();
  await expect(page.getByText('Dev User')).toBeVisible();
});

test('an unreachable API shows the error state and Retry recovers', async ({ page }) => {
  await page.route(`${API_ORIGIN}/**`, (route) => route.abort());

  await page.goto('/');

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Could not reach the server');

  await page.unroute(`${API_ORIGIN}/**`);
  await page.getByRole('button', { name: 'Try again' }).click();

  await expect(page.getByText('Dev User')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('the Overview has no WCAG 2.0 A/AA violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Dev User')).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test('the skip link is the first tab stop', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Tab');

  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
});
