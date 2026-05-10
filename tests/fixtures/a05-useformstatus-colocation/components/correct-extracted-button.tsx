'use client';

import { useFormStatus } from 'react-dom';

// ✅ SubmitButton is a child of the parent form. The hook reads from the
// outer <form>; this is the recommended shape.
const SubmitButton = () => {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>save</button>
  );
};

export const Form = () => (
  <form action="/api/submit">
    <input name="x" />
    <SubmitButton />
  </form>
);
