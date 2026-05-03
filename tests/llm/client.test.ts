import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];

describe('getLlmClient', () => {
  beforeEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
  });

  it('returns undefined when ANTHROPIC_API_KEY is not set', async () => {
    const { getLlmClient } = await import('../../src/llm/client.js?nokey');
    expect(await getLlmClient()).toBeUndefined();
  });

  it('returns a client instance when ANTHROPIC_API_KEY is set', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-fake-key';
    const { getLlmClient } = await import('../../src/llm/client.js?withkey');
    const client = await getLlmClient();
    expect(client).toBeDefined();
    expect(client?.messages).toBeDefined();
  });

  it('returns the cached client on repeat calls', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-fake-key';
    const { getLlmClient } = await import('../../src/llm/client.js?cachecheck');
    const a = await getLlmClient();
    const b = await getLlmClient();
    expect(a).toBe(b);
  });
});
