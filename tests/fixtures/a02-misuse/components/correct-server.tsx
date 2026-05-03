// NON-VIOLATION: Server Component correctly using cookies() from next/headers
import { cookies } from 'next/headers';

export const CorrectServer = async () => {
  const c = await cookies();
  return <p>{c.get('session')?.value ?? 'anon'}</p>;
};
