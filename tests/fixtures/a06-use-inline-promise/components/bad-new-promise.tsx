'use client';

import { use } from 'react';

// ❌ Each render constructs a fresh Promise instance.
export const NewPromise = () => {
  const data = use(new Promise((resolve) => resolve(1)));
  return <span>{String(data)}</span>;
};
