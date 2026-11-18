// End-to-end check of the whole app with no real AI key:
// demo site + mock Ollama + the built Electron app driven by Playwright.
//   npm run test:e2e        (on Linux without a display: xvfb-run -a npm run test:e2e)
import { _electron as electron } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, 'e2e', '.tmp');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const userData = mkdtempSync(join(tmp, 'userdata-'));
const projectsDir = mkdtempSync(join(tmp, 'projects-'));
const shots = join(tmp, 'screenshots');
mkdirSync(shots, { recursive: true });

const SITE_PORT = 4321;
const MOCK_PORT = 11500;
const children = [
  spawn(process.execPath, [join(root, 'scripts/demo-site.mjs'), String(SITE_PORT)], { stdio: 'inherit' }),
  spawn(process.execPath, [join(root, 'scripts/mock-ollama.mjs'), String(MOCK_PORT)], { stdio: 'inherit' })
];
const cleanup = () => children.forEach((c) => c.kill());
process.on('exit', cleanup);

const step = (m) => console.log(`\n▶ ${m}`);
const assert = (cond, msg) => {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
};

await new Promise((r) => setTimeout(r, 800));

const app = await electron.launch({
  args: [join(root, 'out/main/index.js'), `--user-data-dir=${userData}`, '--no-sandbox'],
  cwd: root,
  env: { ...process.env, ELECTRON_RENDERER_URL: '' }
});
const win = await app.firstWindow();
await win.setViewportSize?.({ width: 1500, height: 920 }).catch(() => {});

try {
  step('Welcome screen');
  await win.getByRole('heading', { name: 'AutoGen Test Studio' }).waitFor();
  await win.screenshot({ path: join(shots, '1-welcome.png') });
  assert(await win.getByRole('button', { name: '+ New test project' }).isVisible(), 'New project button shown');

  step('Settings: switch to local Ollama (the mock) and test the connection');
  await win.getByRole('button', { name: 'Add API key' }).click();
  await win.getByLabel('Provider').selectOption('ollama-local');
  await win.getByLabel('Base URL').fill(`http://localhost:${MOCK_PORT}`);
  await win.getByLabel('Model').fill('mock-agent:latest');
  await win.getByRole('button', { name: 'Test & list models' }).click();
  await win.getByText('Connected. 1 model available.').waitFor();
  assert(true, 'Model list fetched from the provider');
  // Anthropic option exists, and warns about subscription tokens.
  const providers = await win.getByLabel('Provider').locator('option').allTextContents();
  assert(providers.includes('Anthropic (Claude)') && providers.includes('Ollama Cloud'), 'Anthropic and Ollama Cloud providers listed');
  await win.screenshot({ path: join(shots, '2-settings.png') });
  await win.getByRole('button', { name: 'Save' }).click();

  step('Create a new test project');
  await win.getByRole('button', { name: '+ New test project' }).click();
  await win.getByLabel('Project name').fill('Demo Shop E2E');
  await win.getByLabel('Application URL').fill(`http://localhost:${SITE_PORT}`);
  await win.getByLabel('Location').fill(projectsDir);
  await win.getByLabel('Install dependencies').uncheck();
  await win.getByRole('button', { name: 'Create project' }).click();
  await win.getByText('EXPLORER', { exact: true }).waitFor();
  const projectDir = join(projectsDir, 'demo-shop-e2e');
  for (const f of ['playwright.config.ts', 'AGENTS.md', 'pages/BasePage.ts', 'fixtures/index.ts', 'tests/smoke.spec.ts', '.env']) {
    assert(existsSync(join(projectDir, f)), `scaffolded ${f}`);
  }
  assert(readFileSync(join(projectDir, '.env'), 'utf8').includes(`BASE_URL=http://localhost:${SITE_PORT}`), '.env has the base URL');
  await win.locator('.tree-row', { hasText: 'smoke.spec.ts' }).waitFor();
  assert(true, 'file tree shows the project structure');

  step('Install the project dependencies (pinned to the Playwright version with local browsers)');
  execSync('npm install --no-audit --no-fund -D @playwright/test@1.63.0 dotenv@16.4.5 typescript@5.8.3 @types/node@22', {
    cwd: projectDir,
    stdio: 'inherit'
  });

  step('Ask the agent to explore and write tests');
  await win.getByLabel('Message to the agent').fill('Explore the login page and create tests for valid and invalid login');
  await win.getByRole('button', { name: 'Send' }).click();
  await win.getByText('Both tests **passed**', { exact: false }).or(win.getByText('Both tests passed')).waitFor({ timeout: 180_000 });
  await win.screenshot({ path: join(shots, '3-agent-done.png') });

  assert(existsSync(join(projectDir, 'pages/LoginPage.ts')), 'agent wrote pages/LoginPage.ts');
  assert(existsSync(join(projectDir, 'tests/login.spec.ts')), 'agent wrote tests/login.spec.ts');
  assert(await win.locator('.tree-row', { hasText: 'LoginPage.ts' }).isVisible(), 'new file appears in the tree');
  assert(await win.locator('.tab', { hasText: 'login.spec.ts' }).isVisible(), 'written spec opened in the editor');
  const toolRows = await win.locator('.tool-row').allTextContents();
  console.log('  tool log:\n   - ' + toolRows.join('\n   - '));
  assert(toolRows.some((t) => t.includes('Opened /')), 'activity log shows navigation');
  assert(toolRows.some((t) => /Tests passed/.test(t)), 'activity log shows passing test run');
  assert((await win.locator('.tool-row.fail').count()) === 0, 'no failed tool calls');

  step('Run all tests from the toolbar');
  await win.getByRole('button', { name: '▶ Run tests' }).click();
  await win.locator('.terminal-output').getByText(/\[exit 0\]\s*$/).waitFor({ timeout: 120_000 });
  const term = await win.locator('.terminal-output').textContent();
  assert(/3 passed/.test(term), 'toolbar run: 3 passed (smoke + 2 login)');
  await win.screenshot({ path: join(shots, '4-run-tests.png') });

  step('Chat history persists when the project is reopened');
  await win.getByRole('button', { name: 'Project ▾' }).click();
  await win.getByRole('menuitem', { name: 'Close project' }).click();
  await win.getByRole('button', { name: /Demo Shop E2E/ }).click();
  await win.getByText('Explore the login page and create tests').waitFor();
  assert(true, 'transcript restored');

  console.log('\nE2E PASSED. Screenshots in e2e/.tmp/screenshots');
} catch (e) {
  await win.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
  console.error('\nE2E FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await app.close();
  cleanup();
}
