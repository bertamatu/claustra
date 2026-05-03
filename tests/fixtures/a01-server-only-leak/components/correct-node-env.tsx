'use client';

export const CorrectNodeEnv = (): JSX.Element => {
  const env = process.env.NODE_ENV;
  const debug = process.env['NODE_ENV'] === 'development';
  return <span>{env}-{String(debug)}</span>;
};
