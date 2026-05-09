'use client';

// Heuristic encryption wrapper: name suggests encryption (`secureEncode`)
// but is not in claustra's recognized helper list. Should emit a MEDIUM
// finding, not a high one - the wrapper might be doing real encryption,
// might be base64-encoding, claustra cannot tell statically.
const secureEncode = (input: string): string => `encoded:${input}`;

export const MediumSecureWrapper = (): JSX.Element => {
  const handle = (token: string): void => {
    localStorage.setItem('auth_token', secureEncode(token));
  };
  return <button onClick={() => handle('x')}>save</button>;
};
