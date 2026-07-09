import { loadConfig } from '@appclaw/core/config';
import {
  isCloud,
  buildCloudHubUrl,
  buildCloudCapabilities,
  cloudProviderLabel,
} from '@appclaw/core/device/cloud';

function show(name: string, overrides: Record<string, string>) {
  const cfg = loadConfig(overrides);
  console.log(`\n=== ${name} (${cloudProviderLabel(cfg)}) isCloud=${isCloud(cfg)}`);
  console.log('hub :', buildCloudHubUrl(cfg).replace(/:[^@/]+@/, ':***@'));
  console.log('caps:', JSON.stringify(buildCloudCapabilities(cfg, 'android')));
}

show('browserstack', {
  CLOUD_PROVIDER: 'browserstack',
  CLOUD_USERNAME: 'user1',
  CLOUD_ACCESS_KEY: 'key1',
  CLOUD_DEVICE_NAME: 'Google Pixel 8',
  CLOUD_OS_VERSION: '14',
  CLOUD_APP: 'bs://abc',
  CLOUD_BUILD_NAME: 'smoke',
  CLOUD_PROJECT_NAME: 'AppClaw',
});

show('saucelabs eu', {
  CLOUD_PROVIDER: 'saucelabs',
  CLOUD_USERNAME: 'u',
  CLOUD_ACCESS_KEY: 'k',
  CLOUD_DEVICE_NAME: 'iPhone 14',
  CLOUD_OS_VERSION: '16',
  CLOUD_REGION: 'eu-central-1',
});

show('lambdatest', {
  CLOUD_PROVIDER: 'lambdatest',
  CLOUD_USERNAME: 'u',
  CLOUD_ACCESS_KEY: 'k',
  CLOUD_DEVICE_NAME: 'Galaxy S24',
  CLOUD_OS_VERSION: '14',
  CLOUD_BUILD_NAME: 'b1',
});

show('custom (auth-in-url)', {
  CLOUD_PROVIDER: 'custom',
  CLOUD_SERVER_URL: 'https://me:secret@grid.internal:4444/wd/hub',
  CLOUD_DEVICE_NAME: 'Pixel_7',
  CLOUD_OS_VERSION: '14',
});

try {
  loadConfig({ CLOUD_PROVIDER: 'custom', CLOUD_DEVICE_NAME: 'x', CLOUD_OS_VERSION: '1' });
  console.log('\nFAIL: custom without CLOUD_SERVER_URL did not throw');
} catch (e) {
  console.log('\nOK: custom w/o URL throws →', (e as Error).message);
}

try {
  loadConfig({ CLOUD_PROVIDER: 'browserstack', CLOUD_DEVICE_NAME: 'x', CLOUD_OS_VERSION: '1' });
  console.log('FAIL: browserstack without creds did not throw');
} catch (e) {
  console.log('OK: bstack w/o creds throws →', (e as Error).message);
}

const local = loadConfig({});
console.log('\nlocal isCloud=', isCloud(local), 'label=', cloudProviderLabel(local));
