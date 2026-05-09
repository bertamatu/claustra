import { cookies } from 'next/headers';

export const getCart = async () => {
  'use cache';
  const store = await cookies();
  const sessionId = store.get('session')?.value;
  return { sessionId, items: [] };
};
