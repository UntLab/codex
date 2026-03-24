"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  CreditCard,
  ExternalLink,
  Loader2,
  LogOut,
  PauseCircle,
  ShieldCheck,
  Users,
} from "lucide-react";
import AdminAuditFeed, {
  type AdminAuditEntry,
} from "@/components/admin/AdminAuditFeed";
import {
  clientBillingMode,
  MANUAL_CARD_STATUS_LABELS,
  type ManualCardStatus,
} from "@/lib/billing";

interface OwnerCard {
  id: string;
  slug: string;
  fullName: string;
  jobTitle?: string | null;
  company?: string | null;
  manualStatus: ManualCardStatus;
  updatedAt: string;
  adminNote?: string | null;
  adminNoteUpdatedAt?: string | null;
  _count: {
    leads: number;
    views: number;
  };
}

interface OwnerDetailData {
  user: {
    id: string;
    name?: string | null;
    email: string;
    role: string;
    createdAt: string;
    _count: {
      cards: number;
      leads: number;
    };
  };
  summary: {
    total: number;
    pending: number;
    active: number;
    paused: number;
  };
  cards: OwnerCard[];
  audit: AdminAuditEntry[];
}

const STATUS_META: Record<
  ManualCardStatus,
  { label: string; className: string; icon: typeof CheckCircle }
> = {
  pending: {
    label: MANUAL_CARD_STATUS_LABELS.pending,
    className: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    icon: AlertTriangle,
  },
  active: {
    label: MANUAL_CARD_STATUS_LABELS.active,
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    icon: CheckCircle,
  },
  paused: {
    label: MANUAL_CARD_STATUS_LABELS.paused,
    className: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    icon: PauseCircle,
  },
};

const STATUS_OPTIONS: ManualCardStatus[] = ["pending", "active", "paused"];

export default function OwnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<OwnerDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkNote, setBulkNote] = useState("");

  const fetchOwnerDetail = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/users/${id}`);

      if (res.status === 403) {
        router.push("/dashboard");
        return;
      }

      if (res.status === 404) {
        router.push("/dashboard/admin");
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to load owner detail");
      }

      const nextData = (await res.json()) as OwnerDetailData;
      setData(nextData);
    } catch {
      alert("Failed to load owner detail");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }

    if (status === "authenticated" && !session?.user?.isAdmin) {
      router.push("/dashboard");
    }
  }, [router, session?.user?.isAdmin, status]);

  useEffect(() => {
    if (
      status === "authenticated" &&
      session?.user?.isAdmin &&
      clientBillingMode === "manual"
    ) {
      void fetchOwnerDetail();
    }
  }, [fetchOwnerDetail, session?.user?.isAdmin, status]);

  const cards = useMemo(() => data?.cards ?? [], [data?.cards]);

  async function updateOwnerStatus(nextStatus: ManualCardStatus) {
    setBulkUpdating(true);

    try {
      const applyNote = bulkNote.trim().length > 0;
      const res = await fetch(`/api/admin/users/${id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: nextStatus,
          applyNote,
          note: applyNote ? bulkNote : null,
        }),
      });

      if (!res.ok) {
        throw new Error("Bulk update failed");
      }

      setBulkNote("");
      await fetchOwnerDetail();
    } catch {
      alert("Bulk update failed");
    } finally {
      setBulkUpdating(false);
    }
  }

  function formatTimestamp(value?: string | null) {
    if (!value) return null;
    return new Date(value).toLocaleString();
  }

  if (status === "loading" || loading || !data) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[var(--color-neon)] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] cyber-grid">
      <nav className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[var(--color-neon)] rounded-md flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-black" />
            </div>
            <span className="text-xl font-bold font-[family-name:var(--font-geist-mono)]">
              Card<span className="text-[var(--color-neon)]">SaaS</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/admin"
              className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)]"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to admin
            </Link>
            <span className="text-sm text-[var(--color-text-muted)] font-[family-name:var(--font-geist-mono)] hidden md:block">
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

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--color-neon)]/20 bg-[var(--color-neon)]/10 text-[var(--color-neon)] text-xs font-[family-name:var(--font-geist-mono)] mb-4">
              <ShieldCheck className="w-3.5 h-3.5" />
              Owner detail
            </div>
            <h1 className="text-3xl font-bold mb-2">
              {data.user.name || data.user.email}
            </h1>
            <p className="text-[var(--color-text-muted)] max-w-2xl">
              {data.user.email} • created {formatTimestamp(data.user.createdAt)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-8">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-[var(--color-text-muted)] mb-2">Cards</p>
            <p className="text-3xl font-bold font-[family-name:var(--font-geist-mono)]">{data.summary.total}</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-amber-200/80 mb-2">Pending</p>
            <p className="text-3xl font-bold font-[family-name:var(--font-geist-mono)] text-amber-200">{data.summary.pending}</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-emerald-200/80 mb-2">Active</p>
            <p className="text-3xl font-bold font-[family-name:var(--font-geist-mono)] text-emerald-200">{data.summary.active}</p>
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-rose-200/80 mb-2">Paused</p>
            <p className="text-3xl font-bold font-[family-name:var(--font-geist-mono)] text-rose-200">{data.summary.paused}</p>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-[var(--color-text-muted)] mb-2">Leads</p>
            <p className="text-3xl font-bold font-[family-name:var(--font-geist-mono)]">{data.user._count.leads}</p>
          </div>
        </div>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-[var(--color-neon)]" />
            <h2 className="text-lg font-semibold">Bulk owner actions</h2>
          </div>
          <textarea
            rows={2}
            value={bulkNote}
            onChange={(event) => setBulkNote(event.target.value)}
            placeholder="Optional note for all this owner's cards"
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 text-sm outline-none resize-y focus:border-[var(--color-neon)]"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
            {STATUS_OPTIONS.map((option) => {
              const optionMeta = STATUS_META[option];
              const OptionIcon = optionMeta.icon;

              return (
                <button
                  key={option}
                  onClick={() => void updateOwnerStatus(option)}
                  disabled={bulkUpdating}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-3 text-left hover:border-[var(--color-neon)] transition-colors disabled:opacity-70"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {bulkUpdating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <OptionIcon className="w-4 h-4" />
                    )}
                    {optionMeta.label}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <div className="space-y-4 mb-8">
          {cards.map((card) => {
            const meta = STATUS_META[card.manualStatus];
            const StatusIcon = meta.icon;

            return (
              <article
                key={card.id}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
              >
                <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                      <h3 className="text-xl font-semibold">{card.fullName}</h3>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-[family-name:var(--font-geist-mono)] ${meta.className}`}>
                        <StatusIcon className="w-3.5 h-3.5" />
                        {meta.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[var(--color-text-muted)]">
                      <span>{card.jobTitle || "No job title"}</span>
                      <span>{card.company || "No company"}</span>
                      <span>{card._count.views} views</span>
                      <span>{card._count.leads} leads</span>
                      <span className="font-[family-name:var(--font-geist-mono)]">/{card.slug}</span>
                    </div>

                    {card.adminNote && (
                      <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-text-muted)] mb-2">
                          Activation note
                        </p>
                        <p className="text-sm">{card.adminNote}</p>
                        {card.adminNoteUpdatedAt && (
                          <p className="mt-2 text-xs text-[var(--color-text-muted)] font-[family-name:var(--font-geist-mono)]">
                            Updated {formatTimestamp(card.adminNoteUpdatedAt)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href={`/card/${card.slug}`}
                      target="_blank"
                      className="inline-flex items-center gap-2 text-xs border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 rounded-lg hover:border-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)]"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open public card
                    </Link>
                    <Link
                      href={`/dashboard/cards/${card.id}/edit`}
                      className="inline-flex items-center gap-2 text-xs border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 rounded-lg hover:border-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)]"
                    >
                      Edit card
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <AdminAuditFeed
          entries={data.audit}
          title="Owner activity timeline"
          emptyText="No audit events yet for this owner."
        />
      </main>
    </div>
  );
}
