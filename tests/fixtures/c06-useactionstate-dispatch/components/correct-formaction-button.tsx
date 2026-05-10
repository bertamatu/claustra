'use client';

import { useActionState } from 'react';

const submit = async (_state: string, _form: FormData): Promise<string> => 'ok';

// ✅ dispatcher passed as `<button formAction>` - same scheduling semantics.
export const FormActionButton = () => {
  const [state, dispatch, pending] = useActionState(submit, '');
  return (
    <form>
      <button formAction={dispatch} disabled={pending}>save</button>
      <span>{state}</span>
    </form>
  );
};
