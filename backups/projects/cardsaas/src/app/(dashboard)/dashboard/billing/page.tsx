"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { CreditCard, LogOut, Sparkles } from "lucide-react";
import { clientBillingMode, MANUAL_BILLING_MESSAGE } from "@/lib/billing";

export default function BillingPage() {
  const { status } = useSession();
  const router = useRouter();
  const isManualMode = clientBillingMode === "manual";

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  if (status === "loading") return null;

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
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-neon-danger)] transition-colors font-[family-name:var(--font-geist-mono)]"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-20">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center shadow-[0_18px_45px_rgba(5,10,28,0.35)]">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[var(--color-neon)]/10 border border-[var(--color-neon)]/30 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-[var(--color-neon)]" />
          </div>
          <h1 className="text-3xl font-bold mb-3">
            {isManualMode ? "Manual activation" : "Billing"}
          </h1>
          <p className="text-[var(--color-text-muted)] max-w-2xl mx-auto leading-7">
            {isManualMode
              ? `${MANUAL_BILLING_MESSAGE} New cards now start in a pending state and are activated or paused manually from the admin panel.`
              : "Paid billing is currently paused while we finalize the payment setup."}
          </p>
          <div className="mt-8">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-[var(--color-neon)] text-black px-6 py-3 rounded-lg font-bold text-sm hover:shadow-[0_0_20px_rgba(0,255,204,0.4)] transition-all font-[family-name:var(--font-geist-mono)]"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
