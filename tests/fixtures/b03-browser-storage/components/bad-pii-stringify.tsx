'use client';

type User = { id: string; email: string; name: string };

export const BadPiiStringify = (): JSX.Element => {
  const cache = (user: User): void => {
    localStorage.setItem('cachedProfile', JSON.stringify(user));
  };
  return <button onClick={() => cache({ id: '1', email: 'a@b', name: 'a' })}>cache</button>;
};
