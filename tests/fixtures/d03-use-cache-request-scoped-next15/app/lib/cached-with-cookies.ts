import { cookies } from 'next/headers';

export const getCart = async () => {
  'use cache';
  const store = await cookies();
  return { sessionId: store.get('session')?.value };
};
