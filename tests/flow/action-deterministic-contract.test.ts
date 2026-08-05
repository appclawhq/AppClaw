import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

import { parseFlowYamlFile } from '@appclaw/core/flow/parse-yaml-flow';

type ActionStep = {
  name?: string;
  env?: Record<string, string>;
  run?: string;
  with?: Record<string, string>;
};

type ActionDefinition = {
  inputs: Record<string, { default?: string; required?: boolean }>;
  runs: { steps: ActionStep[] };
};

type WorkflowJob = {
  if?: string | boolean;
  'runs-on': string;
  steps: Array<{ uses?: string; with?: Record<string, string> }>;
};

type WorkflowDefinition = {
  jobs: Record<string, WorkflowJob>;
};

function readYaml<T>(path: string): T {
  return parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T;
}

function runInputValidation(overrides: Record<string, string> = {}) {
  const action = readYaml<ActionDefinition>('action.yml');
  const validation = action.runs.steps.find((step) => step.name === 'Validate inputs');
  if (!validation?.run) throw new Error('Validate inputs step is missing');

  return spawnSync('bash', ['-euo', 'pipefail', '-c', validation.run], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INPUT_FLOW: 'flows/wdio-android-deterministic.yaml',
      INPUT_GOAL: '',
      INPUT_PLATFORM: 'android',
      INPUT_STRICT: 'true',
      INPUT_AGENT_MODE: 'dom',
      INPUT_VISION_MODE: 'never',
      INPUT_API_KEY: '',
      INPUT_CLOUD_PROVIDER: '',
      INPUT_LAMBDATEST_USERNAME: '',
      INPUT_LAMBDATEST_ACCESS_KEY: '',
      INPUT_LAMBDATEST_DEVICE_NAME: '',
      INPUT_LAMBDATEST_OS_VERSION: '',
      ...overrides,
    },
  });
}

describe('deterministic GitHub Action contract', () => {
  test('makes the API key optional only through explicit deterministic inputs', () => {
    const action = readYaml<ActionDefinition>('action.yml');

    expect(action.inputs['api-key']).toMatchObject({ required: false, default: '' });
    expect(action.inputs.strict).toMatchObject({ required: false, default: 'false' });
    expect(action.inputs['vision-mode']).toMatchObject({
      required: false,
      default: 'fallback',
    });

    expect(runInputValidation().status).toBe(0);

    const nonStrict = runInputValidation({ INPUT_STRICT: 'false' });
    expect(nonStrict.status).toBe(1);
    expect(nonStrict.stdout).toContain('Missing LLM API key');

    const visionFallback = runInputValidation({ INPUT_VISION_MODE: 'fallback' });
    expect(visionFallback.status).toBe(1);
    expect(visionFallback.stdout).toContain('Missing LLM API key');

    const goal = runInputValidation({ INPUT_FLOW: '', INPUT_GOAL: 'open Settings' });
    expect(goal.status).toBe(1);
    expect(goal.stdout).toContain('Missing LLM API key');

    expect(
      runInputValidation({
        INPUT_STRICT: 'false',
        INPUT_VISION_MODE: 'fallback',
        INPUT_API_KEY: 'test-key',
      }).status
    ).toBe(0);
  });

  test('passes the vision policy and strict flag to every YAML flow surface', () => {
    const action = readYaml<ActionDefinition>('action.yml');
    const flowSteps = action.runs.steps.filter((step) => step.name?.startsWith('Run YAML flow'));

    expect(flowSteps).toHaveLength(3);
    for (const step of flowSteps) {
      expect(step.env?.VISION_MODE).toBe('${{ inputs.vision-mode }}');
      const command = step.run ?? step.with?.script ?? '';
      expect(command).toContain('${{ inputs.strict }}');
      expect(command).toContain('--strict');
    }
  });

  test.each([
    ['flows/wdio-android-deterministic.yaml', 'com.wdiodemoapp'],
    ['flows/wdio-ios-deterministic.yaml', 'org.wdiodemoapp'],
  ])('%s is fully parseable without an LLM fallback', async (path, appId) => {
    const flow = await parseFlowYamlFile(resolve(process.cwd(), path), { strict: true });

    expect(flow.meta.appId).toBe(appId);
    expect(flow.steps.map((step) => step.kind)).toEqual([
      'launchApp',
      'waitUntil',
      'tap',
      'type',
      'assert',
      'done',
    ]);
  });
});

describe('fork-safe deterministic device jobs', () => {
  test.each([
    ['android-deterministic', 'flows/wdio-android-deterministic.yaml'],
    ['ios-deterministic', 'flows/wdio-ios-deterministic.yaml'],
  ])('%s requires no secret or vision fallback', (id, flowPath) => {
    const workflow = readYaml<WorkflowDefinition>('.github/workflows/layer3-branch-test.yml');
    const job = workflow.jobs[id];
    const actionStep = job.steps.find((step) => step.uses === './');

    expect(job.if).not.toBe(false);
    expect(String(job.if)).toContain("github.event_name == 'pull_request'");
    expect(actionStep?.with).toMatchObject({
      flow: flowPath,
      strict: 'true',
      'agent-mode': 'dom',
      'vision-mode': 'never',
    });
    expect(actionStep?.with).not.toHaveProperty('api-key');
    if (id === 'ios-deterministic') {
      expect(job['runs-on']).toBe('macos-15');
    }
  });
});
