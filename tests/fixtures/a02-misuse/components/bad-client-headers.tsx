'use client';

// VIOLATION A2: client file imports server-only module
import { cookies } from 'next/headers';

export const Bad = () => {
  const c = cookies();
  return <p>{c.toString()}</p>;
};
