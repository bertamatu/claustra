'use client';

import { useActionState } from 'react';

const submit = async (_state: string, _form: FormData): Promise<string> => 'ok';

// ✅ dispatcher passed as `<form action>` - React schedules the transition.
export const FormAction = () => {
  const [state, dispatch, pending] = useActionState(submit, '');
  return (
    <form action={dispatch}>
      <input name="x" />
      <button type="submit" disabled={pending}>save</button>
      <span>{state}</span>
    </form>
  );
};
