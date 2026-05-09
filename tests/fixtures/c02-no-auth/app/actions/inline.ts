import { db } from '../../lib/db.js';
import { auth } from '../../lib/auth-helpers.js';

// Inline 'use server', has auth - OK
export async function inlineGood(id: string): Promise<void> {
  'use server';
  const session = await auth();
  if (!session) throw new Error();
  await db.post.delete({ where: { id } });
}

// Inline 'use server', NO auth - VIOLATION
export async function inlineBad(id: string): Promise<void> {
  'use server';
  await db.post.delete({ where: { id } });
}

// Not a server action (no 'use server') - should NOT flag
export async function notAnAction(id: string): Promise<void> {
  await db.post.delete({ where: { id } });
}
