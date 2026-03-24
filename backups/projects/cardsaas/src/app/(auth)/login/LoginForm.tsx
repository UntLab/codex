"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { CreditCard, LogIn, Loader2 } from "lucide-react";
import styles from "./login.module.css";

function getErrorMessage(authError?: string | null): string {
  if (authError === "CredentialsSignin") {
    return "Invalid email or password";
  }

  if (authError) {
    return "Unable to sign in right now";
  }

  return "";
}

export default function LoginForm({
  callbackUrl,
  authError,
}: {
  callbackUrl?: string;
  authError?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [loading, setLoading] = useState(false);

  const resolvedCallbackUrl = callbackUrl || "/dashboard";
  const error = useMemo(
    () => localError || getErrorMessage(authError),
    [authError, localError]
  );
  const normalizedEmail = email.trim().toLowerCase();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email: normalizedEmail,
        password,
        redirect: false,
        callbackUrl: resolvedCallbackUrl,
      });

      if (!result || result.error) {
        setLocalError("Invalid email or password");
        setLoading(false);
        return;
      }

      window.location.assign(result.url || resolvedCallbackUrl);
    } catch {
      setLocalError("Unable to sign in right now");
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.orbLeft} />
      <div className={styles.orbRight} />

      <div className={styles.header}>
        <Link href="/" className={styles.brand}>
          <div className={styles.brandIcon}>
            <CreditCard className={styles.brandIconSvg} />
          </div>
          <span className={styles.brandText}>
            v.<span className={styles.brandAccent}>2ai</span>
          </span>
        </Link>
        <h1 className={styles.title}>Sign In</h1>
        <p className={styles.subtitle}>
          Enter your credentials to access your account
        </p>
      </div>

      <div className={styles.cardWrap}>
        <div className={styles.cardGlow} />
        <div className={styles.card}>
          <form onSubmit={handleSubmit} className={styles.form}>
            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.field}>
              <label className={styles.label}>Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={styles.input}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className={styles.input}
              />
            </div>

            <button
              type="submit"
              disabled={loading || normalizedEmail.length === 0}
              className={styles.submit}
            >
              {loading ? (
                <Loader2 className={styles.submitIcon} />
              ) : (
                <LogIn className={styles.submitIcon} />
              )}
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div className={styles.footer}>
            No account yet?{" "}
            <Link href="/register" className={styles.footerLink}>
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
