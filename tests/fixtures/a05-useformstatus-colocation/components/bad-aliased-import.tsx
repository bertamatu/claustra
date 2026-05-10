'use client';

import { useFormStatus as useStatus } from 'react-dom';

// ❌ Aliased import - rule must follow the local binding name.
export const Aliased = () => {
  const { pending } = useStatus();
  return (
    <form>
      <button disabled={pending}>save</button>
    </form>
  );
};
