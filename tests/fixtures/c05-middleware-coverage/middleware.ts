// Middleware that covers /admin/:path* and calls auth(). The fixture
// uses this to verify that admin pages are NOT flagged (covered by
// matcher + auth-calling middleware) while pages outside the matcher
// (dashboard, /profile via (authenticated) group) ARE flagged.
import { auth } from './lib/shims';

export const middleware = async (): Promise<Response | undefined> => {
  const session = await auth();
  if (!session) return new Response('unauthorized', { status: 401 });
  return undefined;
};

export const config = {
  matcher: ['/admin/:path*'],
};
