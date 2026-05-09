'use client';

export const BadTokenKey = (): JSX.Element => {
  const handleLogin = (token: string): void => {
    localStorage.setItem('auth_token', token);
  };
  return <button onClick={() => handleLogin('x')}>login</button>;
};
