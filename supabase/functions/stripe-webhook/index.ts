import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-04-10',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

// CRÍTICA-3: Mapa por price_id (estável mesmo com cupons/impostos)
const PLAN_BY_PRICE: Record<string, 'caderneta' | 'empresarial'> = {
  'price_1TClkd0OdUyqvIqVJuNexoLI': 'caderneta',
  'price_1TClke0OdUyqvIqVAztaS2sU': 'empresarial',
};

// ALTA-5: Validação de UUID
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // CRÍTICA-4: Fail-fast se STRIPE_WEBHOOK_SECRET não configurado
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET não configurado — abortando');
    return new Response('Configuration error', { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  let event: Stripe.Event;
  const body = await req.text();

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response(`Webhook Error: ${err instanceof Error ? err.message : 'Unknown'}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.client_reference_id;

        // ALTA-5: Validar formato UUID antes de usar
        if (!tenantId || !UUID_REGEX.test(tenantId)) {
          console.warn(`client_reference_id inválido: ${tenantId}`);
          break;
        }

        // CRÍTICA-3: Expandir line_items e mapear por price_id
        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items'],
        });
        const priceId = fullSession.line_items?.data[0]?.price?.id ?? '';
        const plan = PLAN_BY_PRICE[priceId];

        if (!plan) {
          console.error(`Plano não identificado para price_id: ${priceId}`);
          break;
        }

        const { error } = await supabase
          .from('tenants')
          .update({
            plan,
            plan_status: 'active',
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
            plan_updated_at: new Date().toISOString(),
          })
          .eq('id', tenantId);

        if (error) {
          console.error('Erro ao atualizar tenant após checkout:', error);
        } else {
          console.log(`Tenant ${tenantId} ativado no plano ${plan}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const stripeStatus = sub.status; // active | past_due | canceled | unpaid | ...

        let plan_status: 'active' | 'inactive' | 'past_due' | 'canceled' = 'inactive';
        if (stripeStatus === 'active') plan_status = 'active';
        else if (stripeStatus === 'past_due') plan_status = 'past_due';
        else if (stripeStatus === 'canceled') plan_status = 'canceled';

        const { error } = await supabase
          .from('tenants')
          .update({ plan_status, plan_updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id);

        if (error) {
          console.error('Erro ao atualizar plan_status:', error);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.subscription as string;
        if (subId) {
          // BR-SUB-002: grace period de 7 dias antes de degradar para free
          const gracePeriodEndsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
          await supabase
            .from('tenants')
            .update({ plan_status: 'past_due', plan_updated_at: new Date().toISOString(), grace_period_ends_at: gracePeriodEndsAt })
            .eq('stripe_subscription_id', subId);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;

        const { error } = await supabase
          .from('tenants')
          .update({
            plan: 'free',
            plan_status: 'canceled',
            stripe_subscription_id: null,
            plan_updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);

        if (error) {
          console.error('Erro ao cancelar assinatura:', error);
        }
        break;
      }

      default:
        console.log(`Evento ignorado: ${event.type}`);
    }
  } catch (err) {
    console.error('Erro ao processar evento Stripe:', err);
    return new Response('Internal error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
});
