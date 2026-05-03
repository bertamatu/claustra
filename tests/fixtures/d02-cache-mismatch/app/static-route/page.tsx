// VIOLATION D2: route declared force-static but uses cookies()
import { cookies } from 'next/headers';

export const dynamic = 'force-static';

export default async function Page() {
  const c = await cookies();
  return <p>{c.get('session')?.value}</p>;
}
