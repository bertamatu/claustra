import { cacheLife } from 'next/cache';

export const getCatalog = async () => {
  'use cache';
  cacheLife('hours');
  return { products: [{ id: 1, name: 'shirt' }] };
};
