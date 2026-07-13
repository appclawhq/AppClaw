import { afterAll, beforeAll, describe, test } from '@appclaw/runner';
import { tapLogin } from './steps.js';

// File-scoped: runs once per device, around all tests in this file.
beforeAll(async () => console.log('[beforeAll FILE]'));
afterAll(async () => console.log('[afterAll FILE]'));

describe('Login', () => {
  // describe-scoped: runs once per device, around this group's tests.
  beforeAll(async () => console.log('[beforeAll Login]'));
  afterAll(async () => console.log('[afterAll Login]'));

  test('click login and verify the list is visible', async ({ app }) => {
    await tapLogin(app);
    await app.verify('the list if visible');
  });

  test('toggle slider and verify two green dots are visible', async ({ app }) => {
    await tapLogin(app);
    await app.run('Click on slider');
    await app.verify('two green dot is visisble');
    await app.run('swipe the first green dot to the right');
    await app.verify('the first green dot is on the right');
  });
});
