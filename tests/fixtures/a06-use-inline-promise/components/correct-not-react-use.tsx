'use client';

// A user helper named `use`. The rule must only fire when `use` came from
// the `react` module - not when it's a custom function with the same name.
const use = <T,>(value: T): T => value;

export const Custom = () => {
  const data = use(fetch('/api/data'));
  return <pre>{String(data)}</pre>;
};
