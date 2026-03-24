import { notFound } from "next/navigation";
import {
  getManualCardStatus,
  getManualCardStatusMessage,
} from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import CyberpunkCard from "@/components/CyberpunkCard";
import MinimalCard from "@/components/MinimalCard";
import GradientCard from "@/components/GradientCard";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const card = await prisma.card.findUnique({ where: { slug } });

  if (!card) return { title: "Card not found" };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return {
    title: `${card.fullName} | Digital Identity`,
    description:
      card.bio ||
      `${card.fullName} — ${card.jobTitle || "Digital Business Card"}`,
    openGraph: {
      title: `${card.fullName} | Digital Identity`,
      description:
        card.bio ||
        `${card.fullName} — ${card.jobTitle || "Digital Business Card"}`,
      images: card.avatarUrl
        ? [{ url: card.avatarUrl }]
        : [{ url: `${appUrl}/api/og?name=${encodeURIComponent(card.fullName)}&title=${encodeURIComponent(card.jobTitle || "")}&accent=${encodeURIComponent(card.accentColor)}` }],
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
      title: `${card.fullName} | Digital Identity`,
      description:
        card.bio ||
        `${card.fullName} — ${card.jobTitle || "Digital Business Card"}`,
    },
  };
}

const themeComponents: Record<
  string,
  React.ComponentType<{ card: Record<string, unknown> }>
> = {
  cyberpunk: CyberpunkCard as unknown as React.ComponentType<{ card: Record<string, unknown> }>,
  minimal: MinimalCard as unknown as React.ComponentType<{ card: Record<string, unknown> }>,
  gradient: GradientCard as unknown as React.ComponentType<{ card: Record<string, unknown> }>,
};

export default async function CardPage({ params }: Props) {
  const { slug } = await params;
  const card = await prisma.card.findUnique({
    where: { slug },
    include: { subscription: true },
  });

  if (!card) notFound();

  const manualStatus = getManualCardStatus(card);

  if (manualStatus !== "active") {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-6xl mb-4 font-[family-name:var(--font-geist-mono)] text-[var(--color-neon-danger)] animate-glitch-flicker">
            [BLOCKED]
          </div>
          <p className="text-[var(--color-text-muted)] font-[family-name:var(--font-geist-mono)]">
            {getManualCardStatusMessage(manualStatus)}
            <br />
            Access is managed manually by the CardSaaS team.
          </p>
        </div>
      </div>
    );
  }

  try {
    await prisma.cardView.create({
      data: { cardId: card.id },
    });
  } catch {
    // non-critical
  }

  const CardComponent = themeComponents[card.theme] || themeComponents.cyberpunk;

  return <CardComponent card={card as unknown as Record<string, unknown>} />;
}
