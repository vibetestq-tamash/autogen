// A fake Ollama server for trying the app and for the e2e test: no AI key needed.
// It replays a scripted session: explore the demo login page, write a page object
// and a spec, run them, and report. Start the demo site with: node scripts/demo-site.mjs
//
//   node scripts/mock-ollama.mjs [port]      (default 11500)
// Then in Settings choose "Ollama (local, offline)" with base URL http://localhost:11500
import http from 'node:http';

const port = Number(process.argv[2] || process.env.MOCK_OLLAMA_PORT || 11500);

const LOGIN_PAGE = `import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  readonly path = '/login';
  readonly username: Locator;
  readonly password: Locator;
  readonly signIn: Locator;

  constructor(page: Page) {
    super(page);
    this.username = page.getByLabel('Username');
    this.password = page.getByLabel('Password');
    this.signIn = page.getByRole('button', { name: 'Sign in' });
  }

  async login(user: string, pass: string): Promise<void> {
    await this.username.fill(user);
    await this.password.fill(pass);
    await this.signIn.click();
  }

  async expectError(text: string): Promise<void> {
    await expect(this.page.getByRole('alert')).toHaveText(text);
  }
}
`;

const LOGIN_SPEC = `import { test, expect } from '../fixtures';
import { LoginPage } from '../pages/LoginPage';

test.describe('Login', () => {
  test('signs in with valid credentials', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login('alice', 'secret');
    await expect(page).toHaveURL(/\\/welcome/);
    await expect(page.getByRole('heading', { name: 'Welcome, alice' })).toBeVisible();
  });

  test('shows an error for a wrong password', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login('alice', 'wrong');
    await login.expectError('Invalid username or password');
  });
});
`;

const call = (name, args) => ({ function: { name, arguments: args } });

const SCRIPT = [
  { content: 'I will explore the login flow first.', tool_calls: [call('browser_navigate', { url: '/' })] },
  { content: '', tool_calls: [call('browser_click', { role: 'link', name: 'Login' })] },
  {
    content: '',
    tool_calls: [
      call('browser_fill', { label: 'Username', value: 'alice' }),
      call('browser_fill', { label: 'Password', value: 'wrong' })
    ]
  },
  { content: '', tool_calls: [call('browser_click', { role: 'button', name: 'Sign in' })] },
  { content: '', tool_calls: [call('browser_inspect', { role: 'alert' })] },
  {
    content: 'Writing the page object and the spec.',
    tool_calls: [
      call('write_file', { path: 'pages/LoginPage.ts', content: LOGIN_PAGE }),
      call('write_file', { path: 'tests/login.spec.ts', content: LOGIN_SPEC })
    ]
  },
  { content: '', tool_calls: [call('run_tests', { path: 'tests/login.spec.ts' })] }
];

function reply(messages) {
  // The step is the number of assistant turns already in the conversation since the last user message.
  let lastUser = -1;
  messages.forEach((m, i) => m.role === 'user' && (lastUser = i));
  const step = messages.slice(lastUser + 1).filter((m) => m.role === 'assistant').length;
  if (step < SCRIPT.length) return { role: 'assistant', ...SCRIPT[step] };
  const lastTool = [...messages].reverse().find((m) => m.role === 'tool');
  const passed = /passed/.test(lastTool?.content ?? '') && !/failed/.test(lastTool?.content ?? '');
  return {
    role: 'assistant',
    content: passed
      ? 'Done. Created `pages/LoginPage.ts` and `tests/login.spec.ts` with 2 tests:\n- signs in with valid credentials\n- shows an error for a wrong password\n\nBoth tests **passed**.'
      : 'I wrote the tests but they did not pass:\n```\n' + (lastTool?.content ?? '').slice(-800) + '\n```'
  };
}

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'mock-agent:latest' }] }));
      } else if (req.url === '/api/chat' && req.method === 'POST') {
        const data = JSON.parse(body || '{}');
        if (!Array.isArray(data.tools) || !data.tools.length || data.messages?.[0]?.role !== 'system') {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'expected system prompt and tools' }));
          return;
        }
        res.end(JSON.stringify({ model: data.model, message: reply(data.messages), done: true }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  })
  .listen(port, () => console.log(`Mock Ollama on http://localhost:${port}`));
