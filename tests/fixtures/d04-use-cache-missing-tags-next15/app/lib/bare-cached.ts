export const getCatalog = async () => {
  'use cache';
  return { products: [{ id: 1, name: 'shirt' }] };
};
