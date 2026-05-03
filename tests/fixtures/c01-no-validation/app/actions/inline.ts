import { db } from '../../lib/db.js';
import { Schema } from '../../lib/schemas.js';

// VIOLATION
export async function inlineBad(formData: FormData): Promise<void> {
  'use server';
  const name = formData.get('name');
  await db.user.create({ data: { name } });
}

// OK — validated
export async function inlineGood(input: unknown): Promise<void> {
  'use server';
  const data = Schema.parse(input);
  await db.user.create({ data });
}

// Not a server action — should NOT flag
export async function notAnAction(input: unknown): Promise<void> {
  const data = JSON.parse(input as string);
  await db.user.create({ data });
}
