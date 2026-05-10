'use client';

import { use } from 'react';

// ❌ Even the degenerate `Promise.resolve(x)` form creates a new Promise per
// render; the rule still flags it.
export const PromiseStatic = ({ value }: { value: number }) => {
  const v = use(Promise.resolve(value));
  return <span>{v}</span>;
};
