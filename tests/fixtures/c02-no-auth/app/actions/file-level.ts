'use server';
import { db } from '../../lib/db.js';
import { auth, currentUser, requireUserSession, verifyAdminAccess } from '../../lib/auth-helpers.js';

// VIOLATION: mutates without any auth check
export async function deletePostUnsafe(id: string): Promise<void> {
  await db.post.delete({ where: { id } });
}

// OK: auth() called before mutation
export async function deletePost(id: string): Promise<void> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  await db.post.delete({ where: { id } });
}

// OK: Clerk currentUser() before mutation
export async function updatePost(id: string, title: string): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error('Unauthorized');
  await db.post.update({ where: { id }, data: { title } });
}

// VIOLATION: auth call appears AFTER the mutation
export async function badOrdering(id: string): Promise<void> {
  await db.post.delete({ where: { id } });
  const session = await auth();
  void session;
}

// OK: custom helper matching the verify*/require*/etc. regex
export async function deletePostWithCustomAuth(id: string): Promise<void> {
  await requireUserSession();
  await db.post.delete({ where: { id } });
}

// OK: another custom helper match (verifyAdminAccess)
export async function deleteAsAdmin(id: string): Promise<void> {
  await verifyAdminAccess();
  await db.post.delete({ where: { id } });
}

// OK: read-only — no mutation, no flag needed
export async function readPost(id: string): Promise<unknown> {
  return await db.post.findUnique({ where: { id } });
}

// VIOLATION: multiple writes, none guarded
export async function bulkUpdate(ids: string[]): Promise<void> {
  for (const id of ids) {
    await db.post.update({ where: { id }, data: { archived: true } });
  }
}
