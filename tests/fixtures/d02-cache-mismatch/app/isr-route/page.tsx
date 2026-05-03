// VIOLATION D2: route declares revalidate but uses headers() (forces dynamic)
import { headers } from 'next/headers';

export const revalidate = 3600;

export default async function Page() {
  const h = await headers();
  return <p>{h.get('user-agent')}</p>;
}
