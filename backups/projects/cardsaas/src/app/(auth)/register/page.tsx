"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CreditCard, UserPlus, Loader2 } from "lucide-react";
import styles from "./register.module.css";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: normalizedEmail, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        setLoading(false);
        return;
      }

      const result = await signIn("credentials", {
        email: normalizedEmail,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Automatic sign-in failed after registration");
        setLoading(false);
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("Network error");
      setLoading(false);
    }
  };

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
        <h1 className={styles.title}>Create Account</h1>
        <p className={styles.subtitle}>
          Create an account to start managing digital cards
        </p>
      </div>

      <div className={styles.cardWrap}>
        <div className={styles.cardGlow} />
        <div className={styles.card}>
        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <div className={styles.error}>
              {error}
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label}>
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.input}
              placeholder="Your name"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={styles.input}
              placeholder="user@example.com"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              Password *
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className={styles.input}
              placeholder="Minimum 6 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className={styles.submit}
          >
            {loading ? (
              <Loader2 className={styles.submitIcon} />
            ) : (
              <UserPlus className={styles.submitIcon} />
            )}
            {loading ? "Creating..." : "Create account"}
          </button>

          <div className={styles.footer}>
            Already have an account?{" "}
            <Link
              href="/login"
              className={styles.footerLink}
            >
              Sign In
            </Link>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
