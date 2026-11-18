import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Folder names used by every generated project. Kept in one place so the agent prompt matches. */
export const LAYOUT = {
  tests: 'tests',
  pages: 'pages',
  fixtures: 'fixtures',
  data: 'test-data',
  meta: '.autogen'
} as const;

export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'e2e-tests'
  );
}

export function projectTemplate(name: string, baseUrl: string): Record<string, string> {
  const slug = slugify(name);
  return {
    'package.json': JSON.stringify(
      {
        name: slug,
        version: '1.0.0',
        private: true,
        description: `Playwright end-to-end tests for ${name}`,
        scripts: {
          test: 'playwright test',
          'test:headed': 'playwright test --headed',
          'test:ui': 'playwright test --ui',
          report: 'playwright show-report',
          codegen: 'playwright codegen'
        },
        devDependencies: {
          '@playwright/test': '^1.63.0',
          '@types/node': '^22.10.0',
          dotenv: '^16.4.5',
          typescript: '^5.8.3'
        }
      },
      null,
      2
    ) + '\n',

    'playwright.config.ts': `import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

export default defineConfig({
  testDir: './${LAYOUT.tests}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || '${baseUrl}',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ]
});
`,

    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'commonjs',
          moduleResolution: 'node',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          baseUrl: '.'
        },
        include: ['**/*.ts']
      },
      null,
      2
    ) + '\n',

    '.env': `# Environment for the tests. Not committed (see .gitignore).\nBASE_URL=${baseUrl}\n# TEST_USER=\n# TEST_PASSWORD=\n`,
    '.env.example': `BASE_URL=${baseUrl}\nTEST_USER=\nTEST_PASSWORD=\n`,

    '.gitignore': `node_modules/
test-results/
playwright-report/
blob-report/
playwright/.cache/
.env
${LAYOUT.meta}/chat-history.json
`,

    [`${LAYOUT.pages}/BasePage.ts`]: `import { type Page, type Locator, expect } from '@playwright/test';

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
`,

    [`${LAYOUT.fixtures}/index.ts`]: `import { test as base, expect } from '@playwright/test';

/**
 * Custom fixtures. Tests import { test, expect } from here instead of '@playwright/test'.
 * Add shared setup (logged-in state, seeded data, page objects) as fixtures below.
 */
type Fixtures = {};

export const test = base.extend<Fixtures>({});
export { expect };
`,

    [`${LAYOUT.data}/.gitkeep`]: '',

    [`${LAYOUT.tests}/smoke.spec.ts`]: `import { test, expect } from '../${LAYOUT.fixtures}';

test.describe('Smoke', () => {
  test('home page loads', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBeTruthy();
    await expect(page).toHaveTitle(/.+/);
  });
});
`,

    'AGENTS.md': `# Test generation conventions

The AI agent reads this file before every task. Edit it to change how tests are written.

## Structure
- \`${LAYOUT.tests}/\`: spec files, one feature per file: \`<feature>.spec.ts\`.
- \`${LAYOUT.pages}/\`: page objects, one class per page or component: \`<Name>Page.ts\`, extending \`BasePage\`.
- \`${LAYOUT.fixtures}/\`: shared fixtures. Specs import \`{ test, expect }\` from \`../${LAYOUT.fixtures}\`.
- \`${LAYOUT.data}/\`: test data as JSON or TS. No secrets; read credentials from \`process.env\`.

## Locators (in order of preference)
1. \`getByRole\` with an accessible name
2. \`getByLabel\`, \`getByPlaceholder\`, \`getByText\`
3. \`getByTestId\`
4. CSS only when nothing else is stable. Never XPath, never auto-generated class names.

## Style
- Use web-first assertions (\`await expect(locator).toBeVisible()\`), never fixed waits (\`waitForTimeout\`).
- Navigate with relative paths (\`page.goto('/login')\`); \`baseURL\` comes from \`.env\`.
- Each test is independent and can run alone.
- Test names describe behavior: \`'shows an error for a wrong password'\`.
- Reuse existing page objects; extend them instead of creating duplicates.
`,

    'README.md': `# ${name}: end-to-end tests

Playwright tests for ${baseUrl}, generated and maintained with AutoGen Test Studio.

## Setup
\`\`\`bash
npm install
npx playwright install chromium
\`\`\`

## Run
\`\`\`bash
npm test              # all tests, headless
npm run test:headed   # watch the browser
npm run report        # open the last HTML report
\`\`\`

Set \`BASE_URL\` (and any credentials) in \`.env\`. See \`AGENTS.md\` for the conventions the agent follows.
`,

    [`${LAYOUT.meta}/project.json`]: JSON.stringify(
      { name, baseUrl, createdWith: 'AutoGen Test Studio', createdAt: new Date().toISOString() },
      null,
      2
    ) + '\n'
  };
}

/** Writes the template into `dir`. Refuses a non-empty directory so nothing is overwritten. */
export function scaffoldProject(dir: string, name: string, baseUrl: string): void {
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`Folder already exists and is not empty: ${dir}`);
  }
  for (const [rel, content] of Object.entries(projectTemplate(name, baseUrl))) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
}
