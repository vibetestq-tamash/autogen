import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolSpec } from '../llm/types';
import { BrowserSession, describeTarget, type Target } from './browser';
import { deletePath, listFilesFlat, readText, safeResolve, writeText } from '../fsService';
import { killRun, runCommand } from '../runner';
import type { TerminalEvent } from '@shared/types';

const TARGET_PROPS = {
  role: { type: 'string', description: 'ARIA role, e.g. button, link, textbox, heading, checkbox, combobox. Use with name.' },
  name: { type: 'string', description: 'Accessible name, used with role (as shown in the snapshot).' },
  label: { type: 'string', description: 'Form field label text.' },
  placeholder: { type: 'string', description: 'Input placeholder text.' },
  text: { type: 'string', description: 'Visible text of the element.' },
  testId: { type: 'string', description: 'data-testid value.' },
  css: { type: 'string', description: 'CSS selector. Last resort.' },
  exact: { type: 'boolean', description: 'Exact (case-sensitive, whole-string) match for name/label/text.' },
  nth: { type: 'integer', description: '0-based index when several elements match.' }
} as const;

const TARGET_HELP = ' Identify the element with ONE of: role+name, label, placeholder, text, testId or css.';

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'browser_navigate',
    description: 'Open a URL in the exploration browser and return an accessibility snapshot. Relative paths use the project baseURL.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
  },
  {
    name: 'browser_snapshot',
    description: 'Accessibility snapshot (YAML) of the current page: roles, names and text. Use it to find reliable locators.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'browser_click',
    description: 'Click an element, then return the new page snapshot.' + TARGET_HELP,
    parameters: { type: 'object', properties: { ...TARGET_PROPS } }
  },
  {
    name: 'browser_fill',
    description: 'Type a value into an input or textarea (replaces its content).' + TARGET_HELP,
    parameters: { type: 'object', properties: { ...TARGET_PROPS, value: { type: 'string' } }, required: ['value'] }
  },
  {
    name: 'browser_select',
    description: 'Choose option(s) in a <select>.' + TARGET_HELP,
    parameters: {
      type: 'object',
      properties: { ...TARGET_PROPS, values: { type: 'array', items: { type: 'string' } } },
      required: ['values']
    }
  },
  {
    name: 'browser_check',
    description: 'Check or uncheck a checkbox or radio button.' + TARGET_HELP,
    parameters: { type: 'object', properties: { ...TARGET_PROPS, checked: { type: 'boolean' } }, required: ['checked'] }
  },
  {
    name: 'browser_hover',
    description: 'Hover over an element (menus, tooltips).' + TARGET_HELP,
    parameters: { type: 'object', properties: { ...TARGET_PROPS } }
  },
  {
    name: 'browser_press',
    description: 'Press a key, e.g. Enter, Tab, Escape. Optionally on a specific element.',
    parameters: { type: 'object', properties: { key: { type: 'string' }, ...TARGET_PROPS }, required: ['key'] }
  },
  {
    name: 'browser_inspect',
    description: 'Check a locator without acting on it: match count, visibility, text and value. Use it to verify locators and expected results for assertions.' + TARGET_HELP,
    parameters: { type: 'object', properties: { ...TARGET_PROPS } }
  },
  {
    name: 'browser_back',
    description: 'Go back in browser history.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'list_files',
    description: 'List files in the test project (optionally inside a sub-folder).',
    parameters: { type: 'object', properties: { dir: { type: 'string', description: 'Folder relative to the project root.' } } }
  },
  {
    name: 'read_file',
    description: 'Read a file from the test project.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file in the test project with the full content.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative to the project root, e.g. tests/login.spec.ts' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Replace an exact snippet in a file. old_text must appear exactly once.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } },
      required: ['path', 'old_text', 'new_text']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file or folder in the test project.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'run_tests',
    description: 'Run Playwright tests (headless) and return the result. Optionally limit to a file/folder or a test-title pattern.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Spec file or folder, e.g. tests/login.spec.ts' },
        grep: { type: 'string', description: 'Only run tests whose title matches this text.' }
      }
    }
  }
];

export interface ToolContext {
  root: string;
  browser: BrowserSession;
  autoRunTests: boolean;
  onFileWritten: (path: string) => void;
  onTerminal: (e: TerminalEvent) => void;
  signal: AbortSignal;
}

export interface ToolOutcome {
  ok: boolean;
  /** Full text returned to the model. */
  output: string;
  /** One line for the UI log. */
  summary: string;
}

function targetOf(a: Record<string, unknown>): Target {
  const t: Target = {};
  for (const k of ['role', 'name', 'label', 'placeholder', 'text', 'testId', 'css'] as const) {
    if (typeof a[k] === 'string' && a[k]) t[k] = a[k] as string;
  }
  if (typeof a.exact === 'boolean') t.exact = a.exact;
  if (typeof a.nth === 'number') t.nth = a.nth;
  return t;
}

function str(a: Record<string, unknown>, k: string): string {
  const v = a[k];
  if (typeof v !== 'string') throw new Error(`Missing or invalid "${k}"`);
  return v;
}

const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const b = ctx.browser;
  try {
    switch (name) {
      case 'browser_navigate': {
        const url = str(args, 'url');
        return { ok: true, output: await b.navigate(url), summary: `Opened ${url}` };
      }
      case 'browser_snapshot':
        return { ok: true, output: await b.snapshot(), summary: 'Read page snapshot' };
      case 'browser_click': {
        const t = targetOf(args);
        return { ok: true, output: await b.click(t), summary: `Clicked ${describeTarget(t)}` };
      }
      case 'browser_fill': {
        const t = targetOf(args);
        return { ok: true, output: await b.fill(t, str(args, 'value')), summary: `Filled ${describeTarget(t)}` };
      }
      case 'browser_select': {
        const t = targetOf(args);
        const values = Array.isArray(args.values) ? args.values.map(String) : [String(args.values ?? '')];
        return { ok: true, output: await b.select(t, values), summary: `Selected in ${describeTarget(t)}` };
      }
      case 'browser_check': {
        const t = targetOf(args);
        return { ok: true, output: await b.check(t, args.checked !== false), summary: `Set ${describeTarget(t)}` };
      }
      case 'browser_hover': {
        const t = targetOf(args);
        return { ok: true, output: await b.hover(t), summary: `Hovered ${describeTarget(t)}` };
      }
      case 'browser_press': {
        const key = str(args, 'key');
        const t = targetOf(args);
        return { ok: true, output: await b.press(key, t), summary: `Pressed ${key}` };
      }
      case 'browser_inspect': {
        const t = targetOf(args);
        const out = await b.inspect(t);
        return { ok: true, output: out, summary: out.split('.')[0] };
      }
      case 'browser_back':
        return { ok: true, output: await b.back(), summary: 'Went back' };

      case 'list_files': {
        const dir = typeof args.dir === 'string' ? args.dir : '';
        const files = await listFilesFlat(ctx.root, dir.replace(/^\.\/?/, ''));
        return { ok: true, output: files.join('\n') || '(no files)', summary: `Listed ${files.length} files` };
      }
      case 'read_file': {
        const p = str(args, 'path');
        const content = await readText(ctx.root, p);
        return { ok: true, output: content.length > 30000 ? content.slice(0, 30000) + '\n... [truncated]' : content, summary: `Read ${p}` };
      }
      case 'write_file': {
        const p = str(args, 'path');
        await writeText(ctx.root, p, str(args, 'content'));
        ctx.onFileWritten(p);
        return { ok: true, output: `Wrote ${p}`, summary: `Wrote ${p}` };
      }
      case 'edit_file': {
        const p = str(args, 'path');
        const oldText = str(args, 'old_text');
        const content = await readText(ctx.root, p);
        const count = content.split(oldText).length - 1;
        if (count !== 1) throw new Error(`old_text found ${count} times in ${p}; it must match exactly once. Read the file and retry.`);
        await writeText(ctx.root, p, content.replace(oldText, () => str(args, 'new_text')));
        ctx.onFileWritten(p);
        return { ok: true, output: `Edited ${p}`, summary: `Edited ${p}` };
      }
      case 'delete_file': {
        const p = str(args, 'path');
        await deletePath(ctx.root, p);
        return { ok: true, output: `Deleted ${p}`, summary: `Deleted ${p}` };
      }
      case 'run_tests':
        return await runTests(args, ctx);
      default:
        return { ok: false, output: `Unknown tool "${name}".`, summary: `Unknown tool ${name}` };
    }
  } catch (e) {
    const msg = (e as Error).message.split('\n').slice(0, 8).join('\n');
    return { ok: false, output: `Error: ${msg}`, summary: msg.split('\n')[0].slice(0, 160) };
  }
}

async function runTests(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  if (!existsSync(join(ctx.root, 'node_modules', '@playwright', 'test'))) {
    const install = runCommand(ctx.root, 'npm install', ctx.onTerminal, { timeoutMs: 10 * 60_000 });
    const r = await install.done;
    if (r.code !== 0) {
      return { ok: false, output: `npm install failed:\n${r.output.slice(-3000)}`, summary: 'npm install failed' };
    }
  }
  let cmd = 'npx playwright test --reporter=line';
  if (typeof args.path === 'string' && args.path) {
    safeResolve(ctx.root, args.path); // reject paths outside the project
    cmd += ` ${quote(args.path)}`;
  }
  if (typeof args.grep === 'string' && args.grep) cmd += ` --grep ${quote(args.grep)}`;
  const run = runCommand(ctx.root, cmd, ctx.onTerminal, { timeoutMs: 10 * 60_000 });
  const onAbort = () => killRun(run.id);
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  const r = await run.done;
  ctx.signal.removeEventListener('abort', onAbort);
  const tail = r.output.length > 9000 ? '... [earlier output cut]\n' + r.output.slice(-9000) : r.output;
  const passed = /(\d+) passed/.exec(r.output)?.[1];
  const failed = /(\d+) failed/.exec(r.output)?.[1];
  const summary = r.code === 0 ? `Tests passed${passed ? ` (${passed})` : ''}` : `Tests failed${failed ? ` (${failed} failed${passed ? `, ${passed} passed` : ''})` : ''}`;
  if (/Executable doesn't exist|playwright install/.test(r.output)) {
    return {
      ok: false,
      output: tail + '\n\nThe Playwright browser is not installed for this project. Tell the user to click "Install browsers" in the toolbar.',
      summary: 'Browser not installed for the project'
    };
  }
  return { ok: r.code === 0, output: `Exit code ${r.code}\n${tail}`, summary };
}
