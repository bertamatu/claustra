import { cookies } from 'next/headers';
import { auth } from '../../../lib/shims.js';

export const getServerStateForAction = async () => {
  const store = await cookies();
  const session = await auth();
  return { sessionId: store.get('session')?.value, userId: session?.user?.id };
};
