import { verifyUserSession } from '../../../lib/shims.js';

export const getReport = async () => {
  'use cache';
  const user = await verifyUserSession();
  return { ownerId: user.id, rows: [] };
};
