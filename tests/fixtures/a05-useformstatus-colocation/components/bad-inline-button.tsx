'use client';

import { useFormStatus } from 'react-dom';

// ❌ The hook and the <form> are in the same component. Submit button's
// `pending` will be permanently false.
export const InlineForm = () => {
  const { pending } = useFormStatus();
  return (
    <form action="/api/submit">
      <input name="x" />
      <button type="submit" disabled={pending}>save</button>
    </form>
  );
};
