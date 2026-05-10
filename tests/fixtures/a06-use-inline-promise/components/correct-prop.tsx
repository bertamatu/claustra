'use client';

import { use } from 'react';

// ✅ The Promise is created by the parent (Server Component, typically) and
// passed in as a prop. Reference is stable across renders of this component.
type Props = { dataPromise: Promise<unknown> };

export const FromProp = ({ dataPromise }: Props) => {
  const data = use(dataPromise);
  return <pre>{String(data)}</pre>;
};
