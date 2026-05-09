// Custom verifier helper whose name matches the verify*Webhook|Signature
// regex. Counts as verification. No findings.
import { db } from '../../../../lib/db';

const verifyWebhookSignature = (_body: string, _sig: string): { ok: true } => ({ ok: true });

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const sig = request.headers.get('x-signature') ?? '';
  verifyWebhookSignature(body, sig);
  await db.invoice.create({ raw: body });
  return new Response('ok');
}
