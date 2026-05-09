'use client';

export const BadJwt = (): JSX.Element => {
  const save = (jwt: string): void => {
    sessionStorage.setItem('jwt', jwt);
  };
  return <button onClick={() => save('x')}>save</button>;
};
