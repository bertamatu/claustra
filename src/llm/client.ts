import type Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | undefined;

export const getLlmClient = async (): Promise<Anthropic | undefined> => {
  if (!process.env['ANTHROPIC_API_KEY']) return undefined;
  if (_client) return _client;

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  _client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
  return _client;
};
