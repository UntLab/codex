import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { isManualBillingMode } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  if (
    isManualBillingMode() ||
    !process.env.STRIPE_SECRET_KEY ||
    !process.env.STRIPE_WEBHOOK_SECRET
  ) {
    return NextResponse.json({ received: true, mode: "manual" });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 400 }
    );
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const cardId = session.metadata?.cardId;
      if (!cardId) break;

      await prisma.subscription.updateMany({
        where: { cardId },
        data: {
          stripeSubscriptionId: session.subscription as string,
          stripeCustomerId: session.customer as string,
          status: "active",
        },
      });

      await prisma.card.update({
        where: { id: cardId },
        data: { active: true },
      });
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = (invoice as unknown as { subscription: string }).subscription;

      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subscriptionId },
        data: { status: "active" },
      });

      const sub = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: subscriptionId },
      });
      if (sub) {
        await prisma.card.update({
          where: { id: sub.cardId },
          data: { active: true },
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = (invoice as unknown as { subscription: string }).subscription;

      const sub = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: subscriptionId },
      });
      if (sub) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: "past_due" },
        });
        await prisma.card.update({
          where: { id: sub.cardId },
          data: { active: false },
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;

      const sub = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: subscription.id },
      });
      if (sub) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: "canceled" },
        });
        await prisma.card.update({
          where: { id: sub.cardId },
          data: { active: false },
        });
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const subRaw = subscription as unknown as Record<string, unknown>;

      const sub = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: subscription.id },
      });
      if (sub) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            currentPeriodStart: subRaw.current_period_start
              ? new Date((subRaw.current_period_start as number) * 1000)
              : undefined,
            currentPeriodEnd: subRaw.current_period_end
              ? new Date((subRaw.current_period_end as number) * 1000)
              : undefined,
          },
        });

        const isActive = ["active", "trialing"].includes(subscription.status);
        await prisma.card.update({
          where: { id: sub.cardId },
          data: { active: isActive },
        });
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
