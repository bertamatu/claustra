// Ancestor layout for /account/* - calls auth() so all descendant
// pages are considered protected.
import { auth } from '../../lib/shims';

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  return <div>{children}</div>;
}
