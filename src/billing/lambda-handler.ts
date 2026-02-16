import { createCheckoutSession, constructWebhookEvent } from './stripe';
import { formatBalanceForDisplay } from './usage-tracker';
import { repository } from '../database/repository';
import { verifyCheckoutParams } from './checkout-signer';

interface LambdaEvent {
  httpMethod: string;
  path: string;
  queryStringParameters?: Record<string, string>;
  body?: string;
  headers?: Record<string, string>;
  isBase64Encoded?: boolean;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const corsHeaders = {
  'Content-Type': 'text/html',
  'Access-Control-Allow-Origin': '*',
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const path = event.path || '';
  const method = event.httpMethod || 'GET';

  try {
    // GET /billing/checkout?amount=500&user=U123&dbUser=uuid
    if (path.endsWith('/billing/checkout') && method === 'GET') {
      return handleCheckout(event);
    }

    // POST /billing/webhook
    if (path.endsWith('/billing/webhook') && method === 'POST') {
      return handleWebhook(event);
    }

    // GET /billing/success
    if (path.endsWith('/billing/success')) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: successHtml(),
      };
    }

    // GET /billing/cancel
    if (path.endsWith('/billing/cancel')) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: cancelHtml(),
      };
    }

    return {
      statusCode: 404,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error) {
    console.error('Billing handler error:', error);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
    };
  }
}

async function handleCheckout(event: LambdaEvent): Promise<LambdaResponse> {
  const qs = event.queryStringParameters || {};
  const amountCents = parseInt(qs.amount || '0', 10);
  const userId = qs.user || '';
  const dbUserId = qs.dbUser || '';
  const sig = qs.sig || '';

  if (!amountCents || !userId || !dbUserId || !sig) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Missing required parameters' }),
    };
  }

  if (![500, 1000, 2000].includes(amountCents)) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Amount must be 500, 1000, or 2000 cents' }),
    };
  }

  if (!verifyCheckoutParams(amountCents, userId, dbUserId, sig)) {
    return {
      statusCode: 403,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Invalid signature — use /caleo-billing in Slack' }),
    };
  }

  const baseUrl = process.env.BILLING_BASE_URL || 'https://your-domain.com';
  const checkoutUrl = await createCheckoutSession({
    userId,
    dbUserId,
    amountCents,
    successUrl: `${baseUrl}/billing/success`,
    cancelUrl: `${baseUrl}/billing/cancel`,
  });

  // Redirect to Stripe Checkout
  return {
    statusCode: 302,
    headers: { Location: checkoutUrl, ...corsHeaders },
    body: '',
  };
}

async function handleWebhook(event: LambdaEvent): Promise<LambdaResponse> {
  const signature = event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature'] || '';
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf-8')
    : event.body || '';

  const stripeEvent = constructWebhookEvent(rawBody, signature);

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object as any;
    const dbUserId = session.metadata?.dbUserId;
    const amountCents = parseInt(session.metadata?.amountCents || '0', 10);

    if (!dbUserId || !amountCents) {
      console.warn('Webhook missing metadata:', session.metadata);
      return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ received: true }) };
    }

    // Idempotency check
    const alreadyProcessed = await repository.checkStripeEventProcessed(stripeEvent.id);
    if (!alreadyProcessed) {
      await repository.creditBalance(dbUserId, amountCents);
      await repository.markStripeEventProcessed(stripeEvent.id, stripeEvent.type, dbUserId, amountCents);

      const balance = await repository.getBalance(dbUserId);
      console.log(`Credited ${formatBalanceForDisplay(amountCents)} to user ${dbUserId}. New balance: ${formatBalanceForDisplay(balance.balance_cents)}`);
    }
  }

  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({ received: true }),
  };
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html><head><title>Payment Successful</title>
<style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#f8faf9}
h1{color:#2d7a4f;margin-bottom:8px}p{color:#555;font-size:18px}.icon{font-size:64px;margin-bottom:16px}</style>
</head><body>
<div class="icon">&#10003;</div>
<h1>Payment Successful!</h1>
<p>Your Caleo balance has been topped up.</p>
<p>You can close this window and return to Slack.</p>
</body></html>`;
}

function cancelHtml(): string {
  return `<!DOCTYPE html>
<html><head><title>Payment Cancelled</title>
<style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#faf8f8}
h1{color:#888;margin-bottom:8px}p{color:#555;font-size:18px}.icon{font-size:64px;margin-bottom:16px}</style>
</head><body>
<div class="icon">&#10007;</div>
<h1>Payment Cancelled</h1>
<p>No charge was made. You can close this window and return to Slack.</p>
<p>Use <code>/caleo-billing</code> in Slack to try again.</p>
</body></html>`;
}
