import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { MANUAL_BILLING_MESSAGE, isManualBillingMode } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { createCheckoutSession, createOrGetCustomer } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isManualBillingMode()) {
    return NextResponse.json(
      { error: MANUAL_BILLING_MESSAGE },
      { status: 503 }
    );
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 503 }
    );
  }

  try {
    const { cardId } = await req.json();

    const card = await prisma.card.findFirst({
      where: { id: cardId, userId: session.user.id },
      include: { subscription: true },
    });

    if (!card) {
      return NextResponse.json(
        { error: "Card not found" },
        { status: 404 }
      );
    }

    const customer = await createOrGetCustomer(
      session.user.email,
      session.user.name || undefined
    );

    const priceId = process.env.STRIPE_PRICE_ID!;

    const checkoutSession = await createCheckoutSession(
      customer.id,
      cardId,
      priceId
    );

    if (!card.subscription) {
      await prisma.subscription.create({
        data: {
          cardId: card.id,
          userId: session.user.id,
          stripeCustomerId: customer.id,
          status: "pending",
        },
      });
    }

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error("Stripe checkout failed", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
