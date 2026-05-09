// Has a dev bypass (correctly exempt) AND a production path that
// forgets to verify. The dev-branch sinks must NOT flag; the
// production-branch sinks MUST flag. Expected: 2 findings (the prod
// req.json() and the prod db write), 0 from the dev branch.
import { db } from '../../../../lib/db';

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'development') {
    const data = await request.json();
    await db.subscription.upsert({ id: (data as { id: string }).id });
    return new Response('dev-ok');
  }
  // Production path - forgot to verify.
  const data = await request.json();
  await db.subscription.upsert({ id: (data as { id: string }).id });
  return new Response('ok');
}
