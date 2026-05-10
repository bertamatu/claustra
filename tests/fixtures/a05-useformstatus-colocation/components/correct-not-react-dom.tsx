'use client';

// ✅ A user-defined helper that happens to share the React 19 hook's name.
// claustra must check the import source, not just the call name.
import { useFormStatus } from './_my-helpers.js';

export const Custom = () => {
  const { pending } = useFormStatus();
  return (
    <form>
      <button disabled={pending}>save</button>
    </form>
  );
};
