'use client';

import { use } from 'react';

// ❌ The async IIFE is invoked every render, producing a new Promise.
export const Iife = () => {
  const data = use((async () => 1)()) as unknown;
  return <span>{String(data)}</span>;
};
