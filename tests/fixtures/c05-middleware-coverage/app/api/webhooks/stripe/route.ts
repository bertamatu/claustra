// Webhook handler - under /webhooks/ segment AND calls a recognized
// signature verifier. Intentionally unauthenticated (signature-based).
// Should NOT flag.
import { stripe, db } from '../../../../lib/shims';

export const POST = async (request: Request): Promise<Response> => {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature') ?? '';
  const event = stripe.webhooks.constructEvent(body, sig, 'whsec_test');
  await db.user.create({ event });
  return new Response('ok');
};
