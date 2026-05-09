// A regular API route at /api/non-webhook/route.ts - path does NOT
// contain "webhook" and there is no webhook-SDK import, so c03 must
// not analyze this file at all. Reads body and writes DB without any
// verifier - proves c03 only fires on webhook handlers.
import { db } from '../../../lib/db';

export async function POST(req: Request): Promise<Response> {
  const data = await req.json();
  await db.invoice.create({ raw: JSON.stringify(data) });
  return new Response('ok');
}
