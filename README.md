# AutoGen Test Studio

A desktop app (Electron) for Playwright test automation driven by an AI agent.

Each **project is its own test-automation repository** on your disk. The app is the UI for that repo:
- a file explorer that shows the repo structure,
- a chat with an AI agent,
- a code editor,
- a terminal.

Describe what to test. The agent opens your application in a real browser, explores it, and writes page objects and specs into the repo. It can then run the tests and fix any failures.

```
┌──────────────┬─────────────────────────────┬────────────────────┐
│ EXPLORER     │ AGENT                       │ login.spec.ts  ×   │
│ ▾ pages/     │ you: explore the login page │                    │
│   LoginPage  │ 🌐 Opened /login            │  test('signs in…', │
│ ▾ tests/     │ ⌨ Filled getByLabel('User') │    …               │
│   login.spec │ 💾 Wrote tests/login.spec.ts│                    │
│ fixtures/    │ 🧪 Tests passed (2)         │                    │
│ AGENTS.md    ├─────────────────────────────┤                    │
│ …            │ TERMINAL  $ npx playwright… │                    │
└──────────────┴─────────────────────────────┴────────────────────┘
```

## AI providers

| Provider | Key | Notes |
|---|---|---|
| **Ollama Cloud** | API key from ollama.com → Settings → API keys | Default. Base URL `https://ollama.com`, e.g. model `gpt-oss:120b`. |
| **Ollama (local)** | none | Fully offline with `ollama serve` and a model that supports tools (e.g. `qwen3`, `llama3.1`). |
| **Anthropic (Claude)** | API key from console.anthropic.com (`sk-ant-api…`) | Default model `claude-opus-5-5`. Uses the official SDK. |
| **OpenAI-compatible** | depends on the server | Any `/chat/completions` endpoint (OpenAI, Groq, LM Studio, vLLM…). |

The model must support tool calling. **Settings → Test & list models** checks the connection.

API keys are stored per provider and encrypted with the operating system's keychain (Electron `safeStorage`). They stay in the main process and are never written into a project.

> **About Claude subscription tokens:** Claude.ai Pro/Max subscription tokens (`sk-ant-oat…`, from `claude setup-token`) only work in Anthropic's own apps such as Claude Code. This app needs an API key. If you paste a subscription token, the app tells you instead of failing silently.

## Requirements

- Node.js 20+ and npm, used to run the generated test projects.
- On first use, internet access to install npm packages and the Chromium browser (`npx playwright install chromium`). Instead of downloading Chromium, you can set **Settings → Exploration browser** to an installed Chrome or Edge.

After that, everything runs locally. The only network calls are to the AI provider (none with local Ollama) and to the application you're testing.

## Getting started

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm run dev
```

1. **Settings**: pick a provider, paste the key, then click **Test & list models**.
2. **New test project**: enter a name, your application's URL, and a folder (default `~/Documents/AutoGenProjects`). This creates a ready-to-run Playwright repo, runs `git init`, and installs its dependencies.
3. Ask the agent, for example *"Explore the login page and create tests for valid and invalid login"*.

Files the agent writes light up in the explorer and open in the editor. Use **Run tests**, **Run headed**, **Report**, or the terminal to run things yourself.

## What a generated project looks like

See [`sample-project/`](sample-project). It's the exact output of the end-to-end test below.

```
my-app-e2e/
├── AGENTS.md            ← conventions the agent follows (edit to change its style)
├── playwright.config.ts ← baseURL from .env
├── .env / .env.example  ← BASE_URL, credentials (not committed)
├── fixtures/index.ts    ← specs import { test, expect } from here
├── pages/               ← page objects (BasePage + <Name>Page.ts)
├── tests/               ← <feature>.spec.ts
├── test-data/
└── .autogen/            ← project metadata, chat history (history is git-ignored)
```

Each project is a normal Playwright repo. Teammates and CI can run `npm test` without this app.

## How the agent works

The agent runs in a tool-use loop. Its tools:

- **Browser:** `navigate`, `snapshot` (accessibility tree), `click`, `fill`, `select`, `check`, `hover`, `press`, `inspect`, `back`.
  Elements are targeted by role and name, label, placeholder, text, test id, or CSS. These map one-to-one to Playwright locators, so any locator that worked during exploration goes straight into the test.
- **Files:** `list_files`, `read_file`, `write_file`, `edit_file`, `delete_file`. All of them are confined to the project folder.
- **`run_tests`:** runs `npx playwright test`, with an automatic `npm install` first if needed. The output goes back to the agent so it can fix failures.

Before each step, the system prompt is rebuilt with the project layout, the current file list, and `AGENTS.md`. Chat history is saved per project in `.autogen/chat-history.json`. **New chat** clears it.

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Start with hot reload |
| `npm run build` | Build to `out/` |
| `npm run typecheck` | TypeScript checks for the main process and the UI |
| `npm run test:e2e` | Full end-to-end test (see below) |
| `npm run dist` | Package installers with electron-builder (`dist/`) |

### Trying it without an AI key

`scripts/mock-ollama.mjs` is a fake Ollama server that replays a scripted agent session. `scripts/demo-site.mjs` is a tiny login site.

```bash
node scripts/demo-site.mjs
```

```bash
node scripts/mock-ollama.mjs
```

In Settings, choose **Ollama (local, offline)** with base URL `http://localhost:11500`. Create a project for `http://localhost:4321` and ask it to test the login page.

`npm run test:e2e` automates this flow. It drives the built app with Playwright and checks every step:
- project scaffolding,
- the file tree,
- agent exploration,
- the written files,
- the passing test run,
- the toolbar run,
- restored chat history.

On Linux without a display, run it as `xvfb-run -a npm run test:e2e`.

### Source layout

```
src/
├── main/              Electron main process
│   ├── index.ts       window + IPC
│   ├── settings.ts    settings, encrypted keys, recent projects
│   ├── scaffold.ts    new-project template
│   ├── fsService.ts   sandboxed file access + watcher
│   ├── runner.ts      runs commands in the project (npm, playwright)
│   ├── llm/           providers: ollama.ts, anthropic.ts, openai.ts
│   └── agent/         agent.ts (loop), tools.ts, browser.ts, prompt.ts
├── preload/           typed bridge (window.api)
├── renderer/          React UI (Monaco editor bundled locally, works offline)
└── shared/types.ts
```
