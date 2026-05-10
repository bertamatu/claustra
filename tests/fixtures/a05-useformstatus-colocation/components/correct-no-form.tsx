'use client';

import { useFormStatus } from 'react-dom';

// ✅ Hook in a component with no form - the form lives somewhere up the tree.
// This is the same as `correct-extracted-button.tsx` but isolated; the rule
// must not flag it.
export const SubmitChip = () => {
  const { pending } = useFormStatus();
  return <span>{pending ? '...' : 'ready'}</span>;
};
