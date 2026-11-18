import { test as base, expect } from '@playwright/test';

/**
 * Custom fixtures. Tests import { test, expect } from here instead of '@playwright/test'.
 * Add shared setup (logged-in state, seeded data, page objects) as fixtures below.
 */
type Fixtures = {};

export const test = base.extend<Fixtures>({});
export { expect };
