import { cacheTag } from 'next/cache';

export const getReport = async (id: string) => {
  'use cache';
  cacheTag(`report-${id}`);
  return { id, rows: [] };
};
