'use client';

import { use } from 'react';

// ✅ `dataPromise` is hoisted to module scope - same reference across all
// renders of every component instance. `use()` resolves cleanly.
const dataPromise = fetch('/api/data');

export const ModuleScope = () => {
  const data = use(dataPromise) as unknown;
  return <pre>{String(data)}</pre>;
};
