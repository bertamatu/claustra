'use server';
import { db } from '../../lib/db.js';
import {
  Schema,
  YupSchema,
  ArkSchema,
  ValibotSchema,
  parse as valibotParse,
  revalidatePath,
  revalidateTag,
} from '../../lib/schemas.js';

// VIOLATION: bare param flows into db.create
export async function createPostUnsafe(formData: FormData): Promise<void> {
  const title = formData.get('title');
  await db.post.create({ data: { title } });
}

// VIOLATION: param into fetch URL
export async function pingUnsafe(url: string): Promise<void> {
  await fetch(url);
}

// VIOLATION: param into fetch body
export async function postUnsafe(payload: unknown): Promise<void> {
  await fetch('https://api.example.com', { method: 'POST', body: JSON.stringify(payload) });
}

// VIOLATION: param into revalidatePath
export async function revalidateUnsafe(p: string): Promise<void> {
  revalidatePath(p);
}

// VIOLATION: param into revalidateTag
export async function revalidateTagUnsafe(tag: string): Promise<void> {
  revalidateTag(tag);
}

// OK: Zod Schema.parse(input) → safe
export async function createPost(input: unknown): Promise<void> {
  const data = Schema.parse(input);
  await db.post.create({ data });
}

// OK: Schema.safeParse → result.data is safe
export async function updatePost(input: unknown): Promise<void> {
  const result = Schema.safeParse<{ id: string; title: string }>(input);
  if (!result.success) throw new Error();
  await db.post.update({ where: { id: result.data.id }, data: { title: result.data.title } });
}

// OK: Valibot free `parse(Schema, input)`
export async function valibotPost(input: unknown): Promise<void> {
  const data = valibotParse(ValibotSchema, input);
  await db.post.create({ data: data as Record<string, unknown> });
}

// OK: Yup validateSync
export async function yupPost(input: unknown): Promise<void> {
  const data = YupSchema.validateSync(input);
  await db.post.create({ data: data as Record<string, unknown> });
}

// OK: Yup async validate (await)
export async function yupAsyncPost(input: unknown): Promise<void> {
  const data = await YupSchema.validate(input);
  await db.post.create({ data: data as Record<string, unknown> });
}

// OK: ArkType assert
export async function arkPost(input: unknown): Promise<void> {
  const data = ArkSchema.assert(input);
  await db.post.create({ data: data as Record<string, unknown> });
}

// OK: action with no parameters (nothing to taint)
export async function noParams(): Promise<void> {
  await db.post.create({ data: { title: 'static' } });
}

// OK: read-only — no sink
export async function getPost(id: string): Promise<unknown> {
  return await db.post.findUnique({ where: { id } });
}

// VIOLATION: JSON.parse is NOT a validator; result remains tainted
export async function jsonParseIsNotValidation(payload: string): Promise<void> {
  const data = JSON.parse(payload);
  await db.post.create({ data });
}

// VIOLATION: derived through chained ops still tainted
export async function chainedPropagation(formData: FormData): Promise<void> {
  const id = formData.get('id') as string;
  const trimmed = id.trim();
  await db.post.delete({ where: { id: trimmed } });
}

// VIOLATION: tainted iteration variable in for-of
export async function bulkCreate(items: { title: string }[]): Promise<void> {
  for (const item of items) {
    await db.post.create({ data: item });
  }
}
