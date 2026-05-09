// Generic webhook (path-based detection only — no SDK import). Reads
// body and writes to DB without any verifier in scope. Two findings.
import { db } from '../../../../lib/db';

export async function POST(req: Request): Promise<Response> {
  const text = await req.text();
  await db.invoice.create({ raw: text });
  return new Response('ok');
}
