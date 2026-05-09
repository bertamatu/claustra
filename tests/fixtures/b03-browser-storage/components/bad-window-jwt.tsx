'use client';

// window.localStorage variant — must be flagged identically to the
// bare-identifier form.
export const BadWindowJwt = (): JSX.Element => {
  const save = (jwt: string): void => {
    window.localStorage.setItem('jwt', jwt);
  };
  return <button onClick={() => save('x')}>save</button>;
};
