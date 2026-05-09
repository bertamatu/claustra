// /billing - sensitive segment "billing", NOT covered by middleware
// matcher, but the page itself calls auth() before rendering.
// Should NOT flag.
import { auth } from '../../lib/shims';

export default async function BillingPage(): Promise<JSX.Element> {
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  return <div>Billing</div>;
}
