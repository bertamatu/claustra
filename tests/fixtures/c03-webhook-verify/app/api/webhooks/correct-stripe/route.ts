// Canonical Stripe pattern: read raw body, pass to constructEvent,
// then use only the verified event. No findings.
import Stripe from 'stripe';
import { db } from '../../../../lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET ?? '');

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature') ?? '';
  const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET ?? '');
  await db.subscription.create({ id: (event.data.object as { id: string }).id });
  return new Response('ok');
}
