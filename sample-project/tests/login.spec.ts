import { test, expect } from '../fixtures';
import { LoginPage } from '../pages/LoginPage';

test.describe('Login', () => {
  test('signs in with valid credentials', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login('alice', 'secret');
    await expect(page).toHaveURL(/\/welcome/);
    await expect(page.getByRole('heading', { name: 'Welcome, alice' })).toBeVisible();
  });

  test('shows an error for a wrong password', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login('alice', 'wrong');
    await login.expectError('Invalid username or password');
  });
});
