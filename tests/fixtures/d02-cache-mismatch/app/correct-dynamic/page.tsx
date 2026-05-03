// NON-VIOLATION: dynamic API used + no static/ISR declaration → intentionally dynamic
import { cookies } from 'next/headers';

export default async function Page() {
  const c = await cookies();
  return <p>{c.get('session')?.value}</p>;
}
