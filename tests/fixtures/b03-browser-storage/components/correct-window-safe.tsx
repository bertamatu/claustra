'use client';

// window.<storage>.setItem with a non-suspect key - must not flag.
export const CorrectWindowSafe = (): JSX.Element => {
  const handle = (): void => {
    window.sessionStorage.setItem('expanded', '1');
    window.localStorage.setItem('lang', 'en');
  };
  return <button onClick={handle}>collapse</button>;
};
