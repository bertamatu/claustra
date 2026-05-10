'use client';

import { useActionState, useTransition } from 'react';

const submit = async (_state: string, _form: FormData): Promise<string> => 'ok';

// ✅ The startTransition returned by useTransition() works the same way.
// Most codebases destructure it under the canonical name `startTransition`.
export const UseTransition = () => {
  const [state, dispatch] = useActionState(submit, '');
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          dispatch(new FormData());
        });
      }}
    >
      {state}
    </button>
  );
};
