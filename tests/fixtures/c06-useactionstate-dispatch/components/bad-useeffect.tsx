'use client';

import { useActionState, useEffect } from 'react';

const refreshAction = async (_state: number, _input: number): Promise<number> => 0;

// ❌ dispatcher called from useEffect without startTransition wrap.
export const AutoRefresh = ({ id }: { id: number }) => {
  const [state, dispatch] = useActionState(refreshAction, 0);
  useEffect(() => {
    dispatch(id);
  }, [id, dispatch]);
  return <span>{state}</span>;
};
