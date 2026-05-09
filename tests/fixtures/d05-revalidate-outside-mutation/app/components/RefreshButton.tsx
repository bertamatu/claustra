'use client';

import { revalidateTag } from 'next/cache';

export const RefreshButton = () => {
  return (
    <button onClick={() => revalidateTag('feed')}>
      refresh
    </button>
  );
};
