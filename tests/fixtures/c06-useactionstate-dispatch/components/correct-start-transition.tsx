'use client';

import { useActionState, startTransition } from 'react';

const submit = async (_state: string, _form: FormData): Promise<string> => 'ok';

// ✅ dispatcher called inside startTransition() - explicit transition wrap.
export const ManualTransition = () => {
  const [state, dispatch, pending] = useActionState(submit, '');
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
