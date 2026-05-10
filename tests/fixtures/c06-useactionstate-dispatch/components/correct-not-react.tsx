'use client';

// User helper that happens to share the React 19 hook name. The rule must
// only track dispatchers from `import ... from 'react'`.
const useActionState = <S, P>(
  _action: (s: S, p: P) => Promise<S>,
  initial: S,
): [S, (p: P) => void, boolean] => [initial, () => undefined, false];

export const Custom = () => {
  const [, dispatch] = useActionState(async (s: number, _p: number) => s, 0);
  return <button onClick={() => dispatch(1)}>tick</button>;
};
