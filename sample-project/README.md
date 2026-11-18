# Demo Shop E2E: end-to-end tests

Playwright tests for http://localhost:4321, generated and maintained with AutoGen Test Studio.

## Setup
```bash
npm install
npx playwright install chromium
```

## Run
```bash
npm test              # all tests, headless
npm run test:headed   # watch the browser
npm run report        # open the last HTML report
```

Set `BASE_URL` (and any credentials) in `.env`. See `AGENTS.md` for the conventions the agent follows.
