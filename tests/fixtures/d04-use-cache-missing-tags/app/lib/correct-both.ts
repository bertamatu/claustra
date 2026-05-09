import { cacheLife, cacheTag } from 'next/cache';

export const getDashboard = async (userId: string) => {
  'use cache';
  cacheLife('minutes');
  cacheTag(`dashboard-${userId}`);
  return { userId, widgets: [] };
};
