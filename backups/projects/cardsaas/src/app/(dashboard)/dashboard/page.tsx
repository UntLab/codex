"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CreditCard,
  Plus,
  Eye,
  ExternalLink,
  Pencil,
  Trash2,
  QrCode,
  LogOut,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Users,
  Palette,
  UserPlus,
  ShieldCheck,
} from "lucide-react";
import {
  clientBillingMode,
  getManualCardStatus,
  MANUAL_CARD_STATUS_LABELS,
  type ManualCardStatus,
} from "@/lib/billing";

interface CardData {
  id: string;
  slug: string;
  fullName: string;
  jobTitle?: string;
  company?: string;
  active: boolean;
  createdAt: string;
  trialEndsAt?: string | null;
  theme: string;
  accentColor: string;
  manualStatus?: ManualCardStatus;
  subscription?: {
    status: string;
    currentPeriodEnd?: string;
  };
  _count: { views: number };
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isManualMode = clientBillingMode === "manual";
  const [cards, setCards] = useState<CardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated") {
      fetchCards();
    }
  }, [status]);

  const fetchCards = async () => {
    try {
      const res = await fetch("/api/cards");
      const data = await res.json();
      setCards(data.cards || []);
    } catch {
      console.error("Failed to fetch cards");
    } finally {
      setLoading(false);
    }
  };

  const deleteCard = async (id: string) => {
    if (!confirm("Are you sure? This card will be permanently deleted.")) return;
    setDeleting(id);
    try {
      await fetch(`/api/cards/${id}`, { method: "DELETE" });
      setCards((prev) => prev.filter((c) => c.id !== id));
    } catch {
      alert("Failed to delete card");
    } finally {
      setDeleting(null);
    }
  };

  const getTrialEndDate = (card: CardData) => {
    if (card.trialEndsAt) return new Date(card.trialEndsAt);
    const fallback = new Date(card.createdAt);
    fallback.setDate(fallback.getDate() + 14);
    return fallback;
  };

  const getTrialDaysLeft = (card: CardData) => {
    const trialEnd = getTrialEndDate(card).getTime();
    const now = Date.now();
    const diff = trialEnd - now;
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const getStatusBadge = (card: CardData) => {
    if (isManualMode) {
      const manualStatus = card.manualStatus ?? getManualCardStatus(card);

      if (manualStatus === "active") {
        return (
          <span className="flex items-center gap-1 text-xs font-[family-name:var(--font-geist-mono)] text-emerald-300">
            <CheckCircle className="w-3 h-3" />
            {MANUAL_CARD_STATUS_LABELS.active}
          </span>
        );
      }

      if (manualStatus === "paused") {
        return (
          <span className="flex items-center gap-1 text-xs font-[family-name:var(--font-geist-mono)] text-rose-300">
            <XCircle className="w-3 h-3" />
            {MANUAL_CARD_STATUS_LABELS.paused}
          </span>
        );
      }

      return (
        <span className="flex items-center gap-1 text-xs font-[family-name:var(--font-geist-mono)] text-amber-300">
          <AlertTriangle className="w-3 h-3" />
          {MANUAL_CARD_STATUS_LABELS.pending}
        </span>
      );
    }

    const sub = card.subscription;
    if (sub?.status === "active") {
      return (
        <span className="flex items-center gap-1 text-xs font-[family-name:var(--font-geist-mono)] text-yellow-400">
          <CheckCircle className="w-3 h-3" />
          Active
        </span>
      );
    }

    const trialDaysLeft = getTrialDaysLeft(card);

    if (trialDaysLeft > 0) {
      return (
        <span className="flex items-center gap-1 text-xs font-[family-name:var(--font-geist-mono)] text-cyan-300">
          <AlertTriangle className="w-3 h-3" />
          Trial: {trialDaysLeft}d left
        </span>
      );
    }

    return (
      <span className="flex items-center gap-1 text-xs font-[family-name:var(--font-geist-mono)] text-amber-300">
        <XCircle className="w-3 h-3" />
        Billing paused
      </span>
    );
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[var(--color-neon)] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] cyber-grid">
      <nav className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[var(--color-neon)] rounded-md flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-black" />
            </div>
            <span className="text-xl font-bold font-[family-name:var(--font-geist-mono)]">
              Card<span className="text-[var(--color-neon)]">SaaS</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/leads"
              className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)] hidden md:flex"
            >
              <Users className="w-4 h-4" />
              Leads
            </Link>
            <Link
              href="/dashboard/templates"
              className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)] hidden md:flex"
            >
              <Palette className="w-4 h-4" />
              Templates
            </Link>
            <Link
              href="/dashboard/team"
              className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)] hidden md:flex"
            >
              <UserPlus className="w-4 h-4" />
              Team
            </Link>
            {session?.user?.isAdmin && (
              <Link
                href="/dashboard/admin"
                className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)] hidden md:flex"
              >
                <ShieldCheck className="w-4 h-4" />
                Admin
              </Link>
            )}
            <span className="text-sm text-[var(--color-text-muted)] font-[family-name:var(--font-geist-mono)] hidden sm:block">
              {session?.user?.name || session?.user?.email}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-neon-danger)] transition-colors font-[family-name:var(--font-geist-mono)]"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-1">My Cards</h1>
            <p className="text-sm text-[var(--color-text-muted)] font-[family-name:var(--font-geist-mono)]">
              Manage your digital business cards
            </p>
          </div>
          <Link
            href="/dashboard/cards/new"
            className="flex items-center gap-2 bg-[var(--color-neon)] text-black px-5 py-2.5 rounded-lg font-bold text-sm hover:shadow-[0_0_20px_rgba(0,255,204,0.4)] transition-all font-[family-name:var(--font-geist-mono)]"
          >
            <Plus className="w-4 h-4" />
            New Card
          </Link>
        </div>

        {cards.length === 0 ? (
          <div className="text-center py-20 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <CreditCard className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No cards yet</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">
              Create your first digital business card in minutes
            </p>
            <Link
              href="/dashboard/cards/new"
              className="inline-flex items-center gap-2 bg-[var(--color-neon)] text-black px-6 py-3 rounded-lg font-bold text-sm hover:shadow-[0_0_20px_rgba(0,255,204,0.4)] transition-all font-[family-name:var(--font-geist-mono)]"
            >
              <Plus className="w-4 h-4" />
              Create Card
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cards.map((card) => (
              <div
                key={card.id}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden hover:border-[var(--color-neon)]/50 transition-all group"
              >
                <div
                  className="h-2"
                  style={{ backgroundColor: card.accentColor }}
                />
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-bold text-lg">{card.fullName}</h3>
                      {card.jobTitle && (
                        <p className="text-sm text-[var(--color-neon)] font-[family-name:var(--font-geist-mono)]">
                          {card.jobTitle}
                        </p>
                      )}
                      {card.company && (
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {card.company}
                        </p>
                      )}
                    </div>
                    {getStatusBadge(card)}
                  </div>

                  <div className="flex items-center gap-4 mb-4 text-sm text-[var(--color-text-muted)]">
                    <span className="flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" />
                      {card._count.views} views
                    </span>
                    <span className="font-[family-name:var(--font-geist-mono)] text-xs">
                      /{card.slug}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/card/${card.slug}`}
                      target="_blank"
                      className="flex items-center gap-1 text-xs bg-[var(--color-bg-base)] border border-[var(--color-border)] px-3 py-2 rounded-md hover:border-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)]"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open
                    </Link>
                    <Link
                      href={`/dashboard/cards/${card.id}/edit`}
                      className="flex items-center gap-1 text-xs bg-[var(--color-bg-base)] border border-[var(--color-border)] px-3 py-2 rounded-md hover:border-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)]"
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                    </Link>
                    <Link
                      href={`/card/${card.slug}`}
                      target="_blank"
                      className="flex items-center gap-1 text-xs bg-[var(--color-bg-base)] border border-[var(--color-border)] px-3 py-2 rounded-md hover:border-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)]"
                    >
                      <QrCode className="w-3 h-3" />
                    </Link>
                    {(!isManualMode &&
                      (!card.subscription ||
                        card.subscription.status !== "active")) && (
                      <Link
                        href="/dashboard/billing"
                        className="flex items-center gap-1 text-xs bg-[var(--color-neon)]/10 border border-[var(--color-neon)]/30 text-[var(--color-neon)] px-3 py-2 rounded-md hover:bg-[var(--color-neon)] hover:text-black transition-all font-[family-name:var(--font-geist-mono)]"
                      >
                        Billing coming soon
                      </Link>
                    )}
                    {isManualMode &&
                      (card.manualStatus ?? getManualCardStatus(card)) !== "active" && (
                      <Link
                        href="/dashboard/billing"
                        className="flex items-center gap-1 text-xs bg-[var(--color-neon)]/10 border border-[var(--color-neon)]/30 text-[var(--color-neon)] px-3 py-2 rounded-md hover:bg-[var(--color-neon)] hover:text-black transition-all font-[family-name:var(--font-geist-mono)]"
                      >
                        {(card.manualStatus ?? getManualCardStatus(card)) === "paused"
                          ? "Reactivation"
                          : "Activation"}
                      </Link>
                    )}
                    <button
                      onClick={() => deleteCard(card.id)}
                      disabled={deleting === card.id}
                      className="flex items-center gap-1 text-xs bg-[var(--color-bg-base)] border border-[var(--color-border)] px-3 py-2 rounded-md hover:border-[var(--color-neon-danger)] hover:text-[var(--color-neon-danger)] transition-colors ml-auto"
                    >
                      {deleting === card.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                    </button>
                  </div>

                  {isManualMode && (
                    <p className="mt-3 text-xs text-[var(--color-text-muted)] font-[family-name:var(--font-geist-mono)]">
                      {(card.manualStatus ?? getManualCardStatus(card)) === "active"
                        ? "This card is live and accessible."
                        : (card.manualStatus ?? getManualCardStatus(card)) ===
                            "paused"
                          ? "This card is hidden until manual reactivation."
                          : "This card is waiting for manual approval."}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
