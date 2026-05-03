'use client';

export const BadProcessEnv = (): JSX.Element => {
  const secret = process.env.SECRET_KEY;
  const dbUrl = process.env['DATABASE_URL'];
  return <span>{secret}{dbUrl}</span>;
};
