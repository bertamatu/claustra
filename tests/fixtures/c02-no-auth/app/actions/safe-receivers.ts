'use server';

// Action that calls things named like mutation methods on safe receivers - should NOT flag.
export async function noopAction(): Promise<unknown> {
  const arr: number[] = [];
  arr.push(1);
  const obj = Object.create(null);
  void obj;
  return JSON.stringify({ ok: true });
}
