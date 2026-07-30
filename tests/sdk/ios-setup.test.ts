import { afterEach, describe, expect, test, vi } from 'vitest';

const readlineMocks = vi.hoisted(() => ({
  close: vi.fn(),
  createInterface: vi.fn(),
  question: vi.fn(),
}));

vi.mock('node:readline', () => ({
  createInterface: readlineMocks.createInterface,
}));

vi.mock('@appclaw/core/ui/terminal', () => ({
  printInfo: vi.fn(),
  printWarning: vi.fn(),
}));

const { checkRealDeviceWDA } = await import('@appclaw/core/device/ios-setup');

function setInteractiveTerminal(): () => void {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });

  return () => {
    delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
    delete (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
  };
}

let restoreTerminal: (() => void) | undefined;

afterEach(() => {
  restoreTerminal?.();
  restoreTerminal = undefined;
  vi.clearAllMocks();
});

describe('checkRealDeviceWDA', () => {
  test('prompts through the ESM readline import in interactive terminals', async () => {
    restoreTerminal = setInteractiveTerminal();
    readlineMocks.createInterface.mockReturnValue({
      close: readlineMocks.close,
      question: readlineMocks.question,
    });
    readlineMocks.question.mockImplementation((_prompt, callback) => callback('yes'));

    await expect(checkRealDeviceWDA()).resolves.toBeUndefined();

    expect(readlineMocks.createInterface).toHaveBeenCalledWith({
      input: process.stdin,
      output: process.stdout,
    });
    expect(readlineMocks.question).toHaveBeenCalledWith(
      '  Continue (WDA already installed)? [Y/n] ',
      expect.any(Function)
    );
    expect(readlineMocks.close).toHaveBeenCalledOnce();
  });
});
