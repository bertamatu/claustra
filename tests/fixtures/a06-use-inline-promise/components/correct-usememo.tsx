'use client';

import { use, useMemo } from 'react';

// ✅ `useMemo` stabilizes the Promise reference across renders that share the
// same `id` dep. Reference changes only when `id` changes, which is the
// intended cache-key shape for `use()`.
export const UseMemo = ({ id }: { id: string }) => {
  const dataPromise = useMemo(() => fetch(`/api/data/${id}`), [id]);
  const data = use(dataPromise) as unknown;
  return <pre>{String(data)}</pre>;
};
