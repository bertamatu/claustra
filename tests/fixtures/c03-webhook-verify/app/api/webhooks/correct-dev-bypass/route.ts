// Dev bypass acceptable because the production branch verifies. With
// callsVerifier() returning true (constructEvent in else branch), the
// whole handler is treated as safe - no findings.
import Stripe from 'stripe';
import { db } from '../../../../lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET ?? '');

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'development') {
    const data = await request.json();
    await db.subscription.upsert({ id: (data as { id: string }).id });
    return new Response('dev-ok');
  }
  const body = await request.text();
  const sig = request.headers.get('stripe-signature') ?? '';
  const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET ?? '');
  await db.subscription.upsert({ id: (event.data.object as { id: string }).id });
  return new Response('ok');
}
