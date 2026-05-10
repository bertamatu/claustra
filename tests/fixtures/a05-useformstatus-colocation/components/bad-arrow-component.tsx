'use client';

import { useFormStatus } from 'react-dom';

// ❌ Arrow-component variant of the colocation bug.
export const Arrow = () => {
  const status = useFormStatus();
  return (
    <form>
      <span>{status.pending ? 'sending...' : 'idle'}</span>
      <button type="submit">submit</button>
    </form>
  );
};
