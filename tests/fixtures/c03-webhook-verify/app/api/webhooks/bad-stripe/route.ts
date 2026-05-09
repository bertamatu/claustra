// Webhook handler that imports `stripe` and reads the body without
// calling `stripe.webhooks.constructEvent`. Two unverified sinks:
//   - request.json()  (body-read)
//   - db.subscription.create(...)  (db-write)
import Stripe from 'stripe';
import { db } from '../../../../lib/db';

void Stripe;

export async function POST(request: Request): Promise<Response> {
  const event = await request.json();
  await db.subscription.create({ id: (event as { id: string }).id });
  return new Response('ok');
}
