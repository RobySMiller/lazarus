import { describe, it, expect } from 'vitest';
import { runHook } from '../src/hooks.js';

describe('hooks', () => {
  it('runs a shell command successfully', async () => {
    await expect(runHook('test', 'echo hello', 'test_event')).resolves.toBeUndefined();
  });

  it('does not throw on non-zero exit', async () => {
    await expect(runHook('test', 'exit 1', 'test_event')).resolves.toBeUndefined();
  });

  it('does not throw on empty command', async () => {
    await expect(runHook('test', '', 'test_event')).resolves.toBeUndefined();
  });
});
