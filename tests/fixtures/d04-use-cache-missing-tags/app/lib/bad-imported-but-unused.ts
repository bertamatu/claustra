// Imports cacheLife but never calls it - the directive is bare in practice.
import { cacheLife as _cacheLife } from 'next/cache';
void _cacheLife;

export const getReport = async () => {
  'use cache';
  return { rows: [] };
};
