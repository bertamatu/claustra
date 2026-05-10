'use client';

import { use } from 'react';

// ❌ `dataPromise` is declared inside the component body and bound to a fresh
// Promise on every render. `use()` sees a new reference each time.
export const LocalVariable = () => {
  const dataPromise = fetch('/api/data');
  const data = use(dataPromise) as unknown;
  return <pre>{String(data)}</pre>;
};
