import { headers } from 'next/headers';

export const getRegionContent = async () => {
  'use cache';
  const h = await headers();
  const region = h.get('x-vercel-ip-country') ?? 'us';
  return { region };
};
