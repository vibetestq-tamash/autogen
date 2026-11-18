# Test generation conventions

The AI agent reads this file before every task. Edit it to change how tests are written.

## Structure
- `tests/`: spec files, one feature per file: `<feature>.spec.ts`.
- `pages/`: page objects, one class per page or component: `<Name>Page.ts`, extending `BasePage`.
- `fixtures/`: shared fixtures. Specs import `{ test, expect }` from `../fixtures`.
- `test-data/`: test data as JSON or TS. No secrets; read credentials from `process.env`.

## Locators (in order of preference)
1. `getByRole` with an accessible name
2. `getByLabel`, `getByPlaceholder`, `getByText`
3. `getByTestId`
4. CSS only when nothing else is stable. Never XPath, never auto-generated class names.

## Style
- Use web-first assertions (`await expect(locator).toBeVisible()`), never fixed waits (`waitForTimeout`).
- Navigate with relative paths (`page.goto('/login')`); `baseURL` comes from `.env`.
- Each test is independent and can run alone.
- Test names describe behavior: `'shows an error for a wrong password'`.
- Reuse existing page objects; extend them instead of creating duplicates.
