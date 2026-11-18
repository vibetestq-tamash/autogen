import { type Page, type Locator, expect } from '@playwright/test';

/** Shared helpers for every page object. */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /** Path of this page relative to baseURL, e.g. '/login'. */
  abstract readonly path: string;

  async goto(): Promise<void> {
    await this.page.goto(this.path);
  }

  async expectVisible(locator: Locator): Promise<void> {
    await expect(locator).toBeVisible();
  }
}
