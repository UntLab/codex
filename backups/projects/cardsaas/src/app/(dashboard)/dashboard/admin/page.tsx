"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import {
  AlertTriangle,
  CheckCircle,
  CreditCard,
  ExternalLink,
  Filter,
  Loader2,
  LogOut,
  PauseCircle,
  Save,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  clientBillingMode,
  MANUAL_CARD_STATUS_LABELS,
  type ManualCardStatus,
} from "@/lib/billing";
import AdminAuditFeed, {
  type AdminAuditEntry,
} from "@/components/admin/AdminAuditFeed";

interface AdminCard {
  id: string;
  slug: string;
  fullName: string;
  jobTitle?: string | null;
  company?: string | null;
  manualStatus: ManualCardStatus;
  createdAt: string;
  updatedAt: string;
  adminNote?: string | null;
  adminNoteUpdatedAt?: string | null;
  adminNoteUpdatedByUserId?: string | null;
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
  };
  _count: {
    leads: number;
    views: number;
  };
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
const FILTER_OPTIONS: Array<{ value: "all" | ManualCardStatus; label: string }> =
  [
    { value: "all", label: "All statuses" },
    { value: "pending", label: MANUAL_CARD_STATUS_LABELS.pending },
    { value: "active", label: MANUAL_CARD_STATUS_LABELS.active },
    { value: "paused", label: MANUAL_CARD_STATUS_LABELS.paused },
  ];

interface OwnerGroup {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  total: number;
  pending: number;
  active: number;
  paused: number;
}

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [recentAudit, setRecentAudit] = useState<AdminAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [bulkUpdatingUserId, setBulkUpdatingUserId] = useState<string | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ManualCardStatus>(
    "all"
  );
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [ownerNoteDrafts, setOwnerNoteDrafts] = useState<
    Record<string, string>
  >({});
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const fetchCards = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/cards");

      if (res.status === 403) {
        router.push("/dashboard");
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to fetch admin cards");
      }

      const data = (await res.json()) as {
        cards: AdminCard[];
        recentAudit: AdminAuditEntry[];
      };
      setCards(data.cards || []);
      setRecentAudit(data.recentAudit || []);
      setNoteDrafts(
        Object.fromEntries(
          (data.cards || []).map((card) => [card.id, card.adminNote ?? ""])
        )
      );
      setOwnerNoteDrafts((current) => {
        const next = { ...current };

        for (const card of data.cards || []) {
          if (!(card.user.id in next)) {
            next[card.user.id] = "";
          }
        }

        return next;
      });
    } catch {
      alert("Failed to load admin activation queue");
    } finally {
      setLoading(false);
    }
  }, [router]);

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
      void fetchCards();
    }
  }, [fetchCards, session?.user?.isAdmin, status]);

  const stats = useMemo(
    () => ({
      total: cards.length,
      pending: cards.filter((card) => card.manualStatus === "pending").length,
      active: cards.filter((card) => card.manualStatus === "active").length,
      paused: cards.filter((card) => card.manualStatus === "paused").length,
    }),
    [cards]
  );

  const filteredCards = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();

    return cards.filter((card) => {
      if (statusFilter !== "all" && card.manualStatus !== statusFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        card.fullName,
        card.slug,
        card.jobTitle,
        card.company,
        card.user.name,
        card.user.email,
        card.adminNote,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [cards, deferredSearchQuery, statusFilter]);

  const ownerGroups = useMemo<OwnerGroup[]>(() => {
    const groups = new Map<string, OwnerGroup>();

    for (const card of filteredCards) {
      const existing = groups.get(card.user.id) ?? {
        userId: card.user.id,
        userName: card.user.name ?? null,
        userEmail: card.user.email ?? null,
        total: 0,
        pending: 0,
        active: 0,
        paused: 0,
      };

      existing.total += 1;
      existing[card.manualStatus] += 1;
      groups.set(card.user.id, existing);
    }

    return [...groups.values()].sort((left, right) => {
      if (left.pending !== right.pending) {
        return right.pending - left.pending;
      }

      if (left.total !== right.total) {
        return right.total - left.total;
      }

      return (left.userEmail ?? left.userName ?? "").localeCompare(
        right.userEmail ?? right.userName ?? ""
      );
    });
  }, [filteredCards]);

  function formatTimestamp(value?: string | null) {
    if (!value) return null;
    return new Date(value).toLocaleString();
  }

  async function updateStatus(cardId: string, nextStatus: ManualCardStatus) {
    setUpdating(cardId);

    try {
      const note = noteDrafts[cardId] ?? "";
      const res = await fetch(`/api/admin/cards/${cardId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: nextStatus, note }),
      });

      if (!res.ok) {
        throw new Error("Failed to update card status");
      }

      await fetchCards();
    } catch {
      alert("Status update failed");
    } finally {
      setUpdating(null);
    }
  }

  async function saveNote(cardId: string) {
    setSavingNote(cardId);

    try {
      const note = noteDrafts[cardId] ?? "";
      const res = await fetch(`/api/admin/cards/${cardId}/note`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ note }),
      });

      if (!res.ok) {
        throw new Error("Failed to save note");
      }

      await fetchCards();
    } catch {
      alert("Note save failed");
    } finally {
      setSavingNote(null);
    }
  }

  async function updateOwnerStatus(
    userId: string,
    nextStatus: ManualCardStatus
  ) {
    setBulkUpdatingUserId(userId);

    try {
      const ownerNote = ownerNoteDrafts[userId] ?? "";
      const applyNote = ownerNote.trim().length > 0;
      const res = await fetch(`/api/admin/users/${userId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: nextStatus,
          applyNote,
          note: applyNote ? ownerNote : null,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to update this owner's cards");
      }

      if (applyNote) {
        setOwnerNoteDrafts((previous) => ({ ...previous, [userId]: "" }));
      }

      await fetchCards();
    } catch {
      alert("Bulk update failed");
    } finally {
      setBulkUpdatingUserId(null);
    }
  }

  if (status === "loading" || (loading && cards.length === 0)) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[var(--color-neon)] animate-spin" />
      </div>
    );
  }

  if (clientBillingMode !== "manual") {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] cyber-grid">
        <main className="max-w-3xl mx-auto px-6 py-24">
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
            <ShieldCheck className="w-12 h-12 text-[var(--color-neon)] mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-3">Admin activation is disabled</h1>
            <p className="text-[var(--color-text-muted)]">
              This page only works while billing mode is set to manual.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex mt-6 items-center gap-2 bg-[var(--color-neon)] text-black px-5 py-2.5 rounded-lg font-bold text-sm font-[family-name:var(--font-geist-mono)]"
            >
              Back to dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] cyber-grid">
      <nav className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
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
              href="/dashboard"
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)]"
            >
              Cards
            </Link>
            <Link
              href="/dashboard/leads"
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)] hidden sm:block"
            >
              Leads
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
              Manual activation queue
            </div>
            <h1 className="text-3xl font-bold mb-2">Admin control</h1>
            <p className="text-[var(--color-text-muted)] max-w-2xl">
              Review all cards, move them between pending, active and paused, and keep manual billing aligned with real access.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-8">
          <div className="flex flex-col xl:flex-row gap-4 xl:items-center">
            <label className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by card, owner, slug, company, or note"
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] pl-10 pr-4 py-3 text-sm outline-none focus:border-[var(--color-neon)]"
              />
            </label>

            <label className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-4 py-3 text-sm">
              <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as "all" | ManualCardStatus)
                }
                className="bg-transparent outline-none"
              >
                {FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {(searchQuery || statusFilter !== "all") && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                }}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-4 py-3 text-sm font-[family-name:var(--font-geist-mono)] hover:border-[var(--color-neon)] transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>

          <p className="mt-3 text-xs text-[var(--color-text-muted)] font-[family-name:var(--font-geist-mono)]">
            Showing {filteredCards.length} of {cards.length} cards across {ownerGroups.length} owners
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-[var(--color-text-muted)] mb-2">Total</p>
            <p className="text-3xl font-bold font-[family-name:var(--font-geist-mono)]">{stats.total}</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-amber-200/80 mb-2">Pending</p>
            <p className="text-3xl font-bold font-[family-name:var(--font-geist-mono)] text-amber-200">{stats.pending}</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-emerald-200/80 mb-2">Active</p>
            <p className="text-3xl font-bold font-[family-name:var(--font-geist-mono)] text-emerald-200">{stats.active}</p>
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-rose-200/80 mb-2">Paused</p>
            <p className="text-3xl font-bold font-[family-name:var(--font-geist-mono)] text-rose-200">{stats.paused}</p>
          </div>
        </div>

        {ownerGroups.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-[var(--color-neon)]" />
              <h2 className="text-lg font-semibold">Owner-level controls</h2>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {ownerGroups.map((group) => (
                <section
                  key={group.userId}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-lg font-semibold">
                          {group.userName || group.userEmail || "Unknown owner"}
                        </h3>
                        <Link
                          href={`/dashboard/admin/owners/${group.userId}`}
                          className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-1 text-xs font-[family-name:var(--font-geist-mono)] text-[var(--color-text-muted)] hover:border-[var(--color-neon)] hover:text-[var(--color-neon)] transition-colors"
                        >
                          Open owner detail
                        </Link>
                      </div>
                      <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        {group.userEmail}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs font-[family-name:var(--font-geist-mono)]">
                        <span className="rounded-full border border-[var(--color-border)] px-3 py-1">
                          {group.total} cards
                        </span>
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-200">
                          {group.pending} pending
                        </span>
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-200">
                          {group.active} active
                        </span>
                        <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-rose-200">
                          {group.paused} paused
                        </span>
                      </div>
                    </div>

                    <div className="lg:w-[320px]">
                      <label className="block text-xs uppercase tracking-[0.22em] text-[var(--color-text-muted)] mb-2">
                        Optional bulk note
                      </label>
                      <textarea
                        rows={2}
                        value={ownerNoteDrafts[group.userId] ?? ""}
                        onChange={(event) =>
                          setOwnerNoteDrafts((previous) => ({
                            ...previous,
                            [group.userId]: event.target.value,
                          }))
                        }
                        placeholder="Apply the same note to all this owner's cards"
                        className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 text-sm outline-none resize-y focus:border-[var(--color-neon)]"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                        {STATUS_OPTIONS.map((option) => {
                          const optionMeta = STATUS_META[option];
                          const OptionIcon = optionMeta.icon;
                          const isBusy = bulkUpdatingUserId === group.userId;

                          return (
                            <button
                              key={`${group.userId}-${option}`}
                              onClick={() =>
                                void updateOwnerStatus(group.userId, option)
                              }
                              disabled={isBusy}
                              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-3 text-left hover:border-[var(--color-neon)] transition-colors disabled:opacity-70"
                            >
                              <div className="flex items-center gap-2 text-sm font-medium">
                                {isBusy ? (
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
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        <div className="mb-8">
          <AdminAuditFeed
            entries={recentAudit}
            emptyText="Admin actions will appear here once you start approving, pausing, or annotating cards."
          />
        </div>

        <div className="space-y-4">
          {filteredCards.map((card) => {
            const meta = STATUS_META[card.manualStatus];
            const StatusIcon = meta.icon;

            return (
              <section
                key={card.id}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[0_18px_45px_rgba(5,10,28,0.18)]"
              >
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                      <h2 className="text-xl font-semibold">{card.fullName}</h2>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-[family-name:var(--font-geist-mono)] ${meta.className}`}>
                        <StatusIcon className="w-3.5 h-3.5" />
                        {meta.label}
                      </span>
                      {card.adminNote && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-neon)]/20 bg-[var(--color-neon)]/10 px-3 py-1 text-xs text-[var(--color-neon)] font-[family-name:var(--font-geist-mono)]">
                          Note attached
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[var(--color-text-muted)]">
                      <span>{card.jobTitle || "No job title"}</span>
                      <span>{card.company || "No company"}</span>
                      <span className="font-[family-name:var(--font-geist-mono)]">/{card.slug}</span>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[var(--color-text-muted)]">
                      <span className="flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        {card._count.leads} leads
                      </span>
                      <span>{card._count.views} views</span>
                      <Link
                        href={`/dashboard/admin/owners/${card.user.id}`}
                        className="hover:text-[var(--color-neon)] transition-colors"
                      >
                        Owner: {card.user.name || card.user.email || "Unknown user"}
                      </Link>
                      <span>{card.user.email}</span>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
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
                      <Link
                        href={`/dashboard/admin/owners/${card.user.id}`}
                        className="inline-flex items-center gap-2 text-xs border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 rounded-lg hover:border-[var(--color-neon)] transition-colors font-[family-name:var(--font-geist-mono)]"
                      >
                        Owner detail
                      </Link>
                    </div>

                    <div className="mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] p-4">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
                          Activation note
                        </p>
                        {card.adminNoteUpdatedAt && (
                          <span className="text-xs text-[var(--color-text-muted)] font-[family-name:var(--font-geist-mono)]">
                            Updated {formatTimestamp(card.adminNoteUpdatedAt)}
                          </span>
                        )}
                      </div>
                      <textarea
                        rows={3}
                        value={noteDrafts[card.id] ?? ""}
                        onChange={(event) =>
                          setNoteDrafts((previous) => ({
                            ...previous,
                            [card.id]: event.target.value,
                          }))
                        }
                        placeholder="Internal note for activation, pause reason, or owner context"
                        className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none resize-y focus:border-[var(--color-neon)]"
                      />
                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={() => void saveNote(card.id)}
                          disabled={
                            savingNote === card.id ||
                            (noteDrafts[card.id] ?? "") === (card.adminNote ?? "")
                          }
                          className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-[family-name:var(--font-geist-mono)] hover:border-[var(--color-neon)] transition-colors disabled:opacity-60"
                        >
                          {savingNote === card.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                          Save note
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="xl:w-[360px]">
                    <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-text-muted)] mb-3">
                      Change access state
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {STATUS_OPTIONS.map((option) => {
                        const optionMeta = STATUS_META[option];
                        const OptionIcon = optionMeta.icon;
                        const isCurrent = option === card.manualStatus;
                        const isBusy = updating === card.id;

                        return (
                          <button
                            key={option}
                            onClick={() => void updateStatus(card.id, option)}
                            disabled={isBusy || isCurrent}
                            className={`rounded-xl border px-3 py-3 text-left transition-all ${
                              isCurrent
                                ? `${optionMeta.className} cursor-default`
                                : "border-[var(--color-border)] bg-[var(--color-bg-base)] hover:border-[var(--color-neon)]"
                            } ${isBusy ? "opacity-70" : ""}`}
                          >
                            <div className="flex items-center gap-2 text-sm font-medium">
                              {isBusy ? (
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
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        {cards.length === 0 && (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
            <ShieldCheck className="w-12 h-12 text-[var(--color-neon)] mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">No cards to review</h2>
            <p className="text-[var(--color-text-muted)]">
              As new cards are created in manual billing mode, they will appear here automatically.
            </p>
          </div>
        )}

        {cards.length > 0 && filteredCards.length === 0 && (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center mt-6">
            <Search className="w-12 h-12 text-[var(--color-neon)] mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">No cards match these filters</h2>
            <p className="text-[var(--color-text-muted)]">
              Change the search query or reset the status filter to see more records.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
