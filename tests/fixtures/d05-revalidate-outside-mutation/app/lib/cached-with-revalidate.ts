import { revalidateTag } from 'next/cache';

export const getThings = async () => {
  'use cache';
  revalidateTag('things'); // ❌ contradictory: cached function invalidating itself
  return { items: [] };
};
