// /api/posts-mutating — exports POST and performs a DB mutation.
// Sensitive (mutating route handler). Middleware matcher does not
// cover it and the handler itself does not call auth(). Expected to
// flag.
import { db } from '../../../lib/shims';

export const POST = async (request: Request): Promise<Response> => {
  const body = (await request.json()) as { title: string };
  await db.user.create({ title: body.title });
  return new Response('ok');
};
