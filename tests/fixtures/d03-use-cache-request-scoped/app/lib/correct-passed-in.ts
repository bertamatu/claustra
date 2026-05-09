import { cookies } from 'next/headers';

const fetchByRegion = async (region: string): Promise<{ region: string; items: string[] }> => {
  'use cache';
  return { region, items: [] };
};

export const getRegionContent = async () => {
  const store = await cookies();
  const region = store.get('region')?.value ?? 'us';
  return fetchByRegion(region);
};
