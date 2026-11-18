import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';

/**
 * How the agent points at an element. Each form maps 1:1 to a Playwright locator,
 * so whatever worked during exploration can be written straight into the test.
 */
export interface Target {
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  testId?: string;
  css?: string;
  exact?: boolean;
  /** 0-based index when several elements match. */
  nth?: number;
}

export function describeTarget(t: Target): string {
  const ex = t.exact ? ', exact: true' : '';
  let code: string;
  if (t.role) code = `getByRole('${t.role}'${t.name ? `, { name: '${t.name}'${ex} }` : ''})`;
  else if (t.label) code = `getByLabel('${t.label}'${ex ? ', { exact: true }' : ''})`;
  else if (t.placeholder) code = `getByPlaceholder('${t.placeholder}')`;
  else if (t.text) code = `getByText('${t.text}'${ex ? ', { exact: true }' : ''})`;
  else if (t.testId) code = `getByTestId('${t.testId}')`;
  else if (t.css) code = `locator('${t.css}')`;
  else code = '(no target)';
  if (t.nth !== undefined) code += `.nth(${t.nth})`;
  return code;
}

const MAX_SNAPSHOT = 14000;

export class BrowserSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private consoleErrors: string[] = [];

  constructor(private opts: { headed: boolean; channel: '' | 'chrome' | 'msedge'; baseUrl?: string }) {}

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (!this.browser || !this.browser.isConnected()) {
      try {
        this.browser = await chromium.launch({
          headless: !this.opts.headed,
          ...(this.opts.channel ? { channel: this.opts.channel } : {})
        });
      } catch (e) {
        const msg = (e as Error).message;
        if (/Executable doesn't exist|browserType.launch/.test(msg) && !this.opts.channel) {
          throw new Error(
            'Playwright Chromium is not installed. Run "npx playwright install chromium" once, ' +
              'or in Settings set Browser to "Installed Google Chrome" / "Installed Microsoft Edge".'
          );
        }
        throw e;
      }
    }
    this.context = await this.browser.newContext({
      baseURL: this.opts.baseUrl,
      viewport: { width: 1280, height: 800 }
    });
    this.page = await this.context.newPage();
    this.page.on('console', (m) => {
      if (m.type() === 'error') this.consoleErrors.push(m.text().slice(0, 300));
    });
    this.page.on('pageerror', (e) => this.consoleErrors.push(e.message.slice(0, 300)));
    return this.page;
  }

  private locate(page: Page, t: Target): Locator {
    let loc: Locator;
    const exact = t.exact ?? false;
    if (t.role) loc = page.getByRole(t.role as Parameters<Page['getByRole']>[0], t.name ? { name: t.name, exact } : undefined);
    else if (t.label) loc = page.getByLabel(t.label, { exact });
    else if (t.placeholder) loc = page.getByPlaceholder(t.placeholder, { exact });
    else if (t.text) loc = page.getByText(t.text, { exact });
    else if (t.testId) loc = page.getByTestId(t.testId);
    else if (t.css) loc = page.locator(t.css);
    else throw new Error('No target given. Use one of: role(+name), label, placeholder, text, testId, css.');
    return t.nth !== undefined ? loc.nth(t.nth) : loc;
  }

  /** Locates the element and fails with a helpful message if it is missing or ambiguous. */
  private async resolveOne(t: Target): Promise<Locator> {
    const page = await this.ensurePage();
    const loc = this.locate(page, t);
    if (t.nth !== undefined) return loc;
    const count = await loc.count();
    if (count === 0) throw new Error(`No element matches ${describeTarget(t)}. Take a snapshot to see what is on the page.`);
    if (count > 1) throw new Error(`${count} elements match ${describeTarget(t)}. Be more specific (add name/exact) or pass nth.`);
    return loc;
  }

  async navigate(url: string): Promise<string> {
    const page = await this.ensurePage();
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    return `Navigated to ${page.url()} (HTTP ${res?.status() ?? '?'}). Title: "${await page.title()}"\n\n${await this.snapshot()}`;
  }

  /** Accessibility-tree snapshot: compact, and uses the same roles/names as getByRole. */
  async snapshot(): Promise<string> {
    const page = await this.ensurePage();
    let tree = await page.locator('body').ariaSnapshot({ timeout: 10000 });
    if (tree.length > MAX_SNAPSHOT) tree = tree.slice(0, MAX_SNAPSHOT) + '\n... [snapshot truncated]';
    const errors = this.consoleErrors.splice(0);
    return (
      `URL: ${page.url()}\nTitle: ${await page.title()}\n` +
      (errors.length ? `Console errors: ${errors.slice(0, 5).join(' | ')}\n` : '') +
      `Accessibility snapshot (YAML):\n${tree}`
    );
  }

  private async afterAction(page: Page): Promise<string> {
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);
    return this.snapshot();
  }

  async click(t: Target): Promise<string> {
    const loc = await this.resolveOne(t);
    await loc.click({ timeout: 10000 });
    return `Clicked ${describeTarget(t)}.\n\n${await this.afterAction(this.page!)}`;
  }

  async fill(t: Target, value: string): Promise<string> {
    const loc = await this.resolveOne(t);
    await loc.fill(value, { timeout: 10000 });
    return `Filled ${describeTarget(t)}.`;
  }

  async select(t: Target, values: string[]): Promise<string> {
    const loc = await this.resolveOne(t);
    await loc.selectOption(values, { timeout: 10000 });
    return `Selected ${values.join(', ')} in ${describeTarget(t)}.\n\n${await this.afterAction(this.page!)}`;
  }

  async check(t: Target, checked: boolean): Promise<string> {
    const loc = await this.resolveOne(t);
    await loc.setChecked(checked, { timeout: 10000 });
    return `${checked ? 'Checked' : 'Unchecked'} ${describeTarget(t)}.`;
  }

  async hover(t: Target): Promise<string> {
    const loc = await this.resolveOne(t);
    await loc.hover({ timeout: 10000 });
    return `Hovered ${describeTarget(t)}.\n\n${await this.afterAction(this.page!)}`;
  }

  async press(key: string, t?: Target): Promise<string> {
    const page = await this.ensurePage();
    if (t && Object.keys(t).length) await (await this.resolveOne(t)).press(key);
    else await page.keyboard.press(key);
    return `Pressed ${key}.\n\n${await this.afterAction(page)}`;
  }

  /** Checks a locator without acting: how many match, visible, text, value. */
  async inspect(t: Target): Promise<string> {
    const page = await this.ensurePage();
    const loc = this.locate(page, t);
    const count = await loc.count();
    if (count === 0) return `0 elements match ${describeTarget(t)}.`;
    const first = loc.first();
    const [visible, text, value] = await Promise.all([
      first.isVisible(),
      first.innerText({ timeout: 2000 }).catch(() => ''),
      first.inputValue({ timeout: 500 }).catch(() => undefined)
    ]);
    return `${count} element(s) match ${describeTarget(t)}. First: visible=${visible}, text="${text.slice(0, 200)}"${
      value !== undefined ? `, value="${value}"` : ''
    }`;
  }

  async back(): Promise<string> {
    const page = await this.ensurePage();
    await page.goBack();
    return this.afterAction(page);
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
    this.page = undefined;
    this.context = undefined;
  }
}
