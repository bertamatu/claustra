'use client';

import { use } from 'react';

// ❌ Each render creates a new fetch Promise; `use()` suspends infinitely.
export const InlineFetch = () => {
  const data = use(fetch('/api/data')) as unknown;
  return <pre>{String(data)}</pre>;
};
