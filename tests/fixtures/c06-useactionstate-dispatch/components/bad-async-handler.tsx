'use client';

import { useActionState } from 'react';

const submit = async (_state: string, _form: FormData): Promise<string> => 'ok';

// ❌ async event handler awaiting the dispatcher - still no startTransition.
export const AsyncHandler = () => {
  const [, dispatch] = useActionState(submit, '');
  const handle = async (e: React.MouseEvent) => {
    e.preventDefault();
    await dispatch(new FormData());
  };
  return <button onClick={handle}>save</button>;
};
