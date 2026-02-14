import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

export interface CheckoutParams {
  userId: string;       // Slack user ID (for metadata)
  dbUserId: string;     // Internal DB user ID
  amountCents: number;  // e.g. 500, 1000, 2000
  successUrl: string;
  cancelUrl: string;
}

/**
 * Create a Stripe Checkout Session for a one-time payment.
 */
export async function createCheckoutSession(params: CheckoutParams): Promise<string> {
  const stripe = getStripe();
  const amountDollars = params.amountCents / 100;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Caleo Credits — $${amountDollars.toFixed(2)}`,
            description: `Add $${amountDollars.toFixed(2)} to your Caleo balance`,
          },
          unit_amount: params.amountCents,
        },
        quantity: 1,
      },
    ],
    metadata: {
      userId: params.userId,
      dbUserId: params.dbUserId,
      amountCents: String(params.amountCents),
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  return session.url || '';
}

/**
 * Construct and verify a Stripe webhook event from the raw body + signature.
 */
export function constructWebhookEvent(body: string | Buffer, signature: string): Stripe.Event {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  return stripe.webhooks.constructEvent(body, signature, secret);
}
