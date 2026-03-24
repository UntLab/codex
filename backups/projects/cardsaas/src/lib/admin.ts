import type { Session } from "next-auth";

export type UserRole = "admin" | "user";

function parseAdminEmails(rawValue?: string | null): Set<string> {
  if (!rawValue) return new Set();

  return new Set(
    rawValue
      .split(/[\n,]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function getConfiguredAdminEmails(): Set<string> {
  return parseAdminEmails(process.env.ADMIN_EMAILS);
}

export function normalizeUserRole(role?: string | null): UserRole {
  return role === "admin" ? "admin" : "user";
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return getConfiguredAdminEmails().has(email.trim().toLowerCase());
}

export function isAdminUser(input: {
  email?: string | null;
  role?: string | null;
}): boolean {
  return normalizeUserRole(input.role) === "admin" || isAdminEmail(input.email);
}

export function isAdminSession(session?: Session | null): boolean {
  if (!session?.user) return false;
  return Boolean(
    session.user.isAdmin ||
      isAdminUser({
        email: session.user.email,
        role: session.user.role,
      })
  );
}
