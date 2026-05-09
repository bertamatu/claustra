// Svix pattern: instantiate Webhook, call .verify on the raw body
// and headers. No findings.
import { Webhook } from 'svix';
import { db } from '../../../../lib/db';

export async function POST(request: Request): Promise<Response> {
  const wh = new Webhook(process.env.SVIX_SECRET ?? '');
  const body = await request.text();
  const headers = {
    'svix-id': request.headers.get('svix-id') ?? '',
    'svix-timestamp': request.headers.get('svix-timestamp') ?? '',
    'svix-signature': request.headers.get('svix-signature') ?? '',
  };
  const evt = wh.verify(body, headers) as { id: string };
  await db.invoice.create({ id: evt.id });
  return new Response('ok');
}
