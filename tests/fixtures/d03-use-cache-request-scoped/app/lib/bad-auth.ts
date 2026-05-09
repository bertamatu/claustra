import { auth } from '../../../lib/shims.js';

export const getDashboardData = async () => {
  'use cache';
  const session = await auth();
  return { userId: session?.user?.id, items: [] };
};
