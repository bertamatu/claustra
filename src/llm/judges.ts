import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { cacheGet, cacheSet } from './cache.js';

const DataLeakageOutput = z.object({
  risky: z.boolean(),
  fields: z.array(z.string()),
  reasoning: z.string(),
});

const ValidationOutput = z.object({
  isValidation: z.boolean(),
  reasoning: z.string(),
});

type DataLeakageResult = z.infer<typeof DataLeakageOutput>;
type ValidationResult = z.infer<typeof ValidationOutput>;

const callJudge = async <T>(
  client: Anthropic,
  model: string,
  cacheKey: string,
  prompt: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> => {
  const cached = cacheGet<T>(cacheKey);
  if (cached !== undefined) return cached;

  const response = await client.messages.create({
    model,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0];
  if (!text || text.type !== 'text') return undefined;

  const jsonMatch = text.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return undefined;

  const parsed = schema.safeParse(JSON.parse(jsonMatch[0]));
  if (!parsed.success) return undefined;

  cacheSet(cacheKey, parsed.data);
  return parsed.data;
};

export const judgeServerLeakage = async (
  client: Anthropic,
  model: string,
  input: { propType: string; componentName: string; cacheKey: string },
): Promise<DataLeakageResult | undefined> => {
  const prompt = `Below is the TypeScript type of a prop being passed from a Server Component to a Client Component named "${input.componentName}" in a Next.js App Router app.

Type: ${input.propType}

Identify any fields that are likely sensitive (auth tokens, password hashes, internal IDs not meant for users, PII beyond what UI needs).

Respond as JSON only: { "risky": boolean, "fields": string[], "reasoning": string }`;

  return callJudge(client, model, input.cacheKey, prompt, DataLeakageOutput);
};

export const judgeIsValidation = async (
  client: Anthropic,
  model: string,
  input: { callExpression: string; cacheKey: string },
): Promise<ValidationResult | undefined> => {
  const prompt = `In a Next.js Server Action, the following function call appears:

${input.callExpression}

Is this function call performing input validation or sanitization (i.e., does it check types, shapes, or safety of untrusted user input)?

Respond as JSON only: { "isValidation": boolean, "reasoning": string }`;

  return callJudge(client, model, input.cacheKey, prompt, ValidationOutput);
};
