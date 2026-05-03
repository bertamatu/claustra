'use client';

export const CorrectPublicEnv = (): JSX.Element => {
  const url = process.env.NEXT_PUBLIC_API_URL;
  return <span>{url}</span>;
};
