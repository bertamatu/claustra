'use client';

// `encrypt` is in claustra's KNOWN_ENCRYPTION_HELPERS list — wrapping
// the value in it is treated as sufficient mitigation, even with a
// suspect-named key. This must NOT be flagged at any severity.
declare const encrypt: (input: string) => string;

export const CorrectEncrypt = (): JSX.Element => {
  const handle = (token: string): void => {
    localStorage.setItem('auth_token', encrypt(token));
  };
  return <button onClick={() => handle('x')}>save</button>;
};
