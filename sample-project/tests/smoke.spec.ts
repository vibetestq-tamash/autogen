import { test, expect } from '../fixtures';

test.describe('Smoke', () => {
  test('home page loads', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBeTruthy();
    await expect(page).toHaveTitle(/.+/);
  });
});
