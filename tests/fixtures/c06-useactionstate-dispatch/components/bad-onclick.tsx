'use client';

import { useActionState } from 'react';

const updateAction = async (_state: number, _formData: FormData): Promise<number> => 0;

// ❌ dispatcher called from onClick without startTransition wrap.
export const ClickyButton = () => {
  const [state, dispatch, pending] = useActionState(updateAction, 0);
  return (
    <button onClick={() => dispatch(new FormData())} disabled={pending}>
      {state}
    </button>
  );
};
