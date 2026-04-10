import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let supabaseClientPromise = null;

async function loadPublicConfig() {
  const response = await fetch("/api/public/config", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.detail || "Unable to load Supabase public config");
  }

  return payload;
}

export async function getSupabaseClient() {
  if (!supabaseClientPromise) {
    supabaseClientPromise = loadPublicConfig().then((config) =>
      createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storageKey: "formag-supabase-auth"
        }
      })
    );
  }

  return supabaseClientPromise;
}

export async function signInWithPassword(email, password) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
  return data;
}

export async function signOutUser() {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function getAccessToken() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session?.access_token || null;
}

export async function authFetch(input, init = {}) {
  const token = await getAccessToken();
  const headers = new Headers(init.headers || {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(input, {
    ...init,
    headers
  });
}

export function getCapabilities(user) {
  if (!user) return [];
  if (Array.isArray(user.capabilities) && user.capabilities.length) {
    return [...new Set(user.capabilities.filter(Boolean))];
  }
  return user.role ? [user.role] : [];
}

export function hasCapability(user, capability) {
  return getCapabilities(user).includes(capability);
}

export function hasAnyCapability(user, capabilities) {
  return capabilities.some((capability) => hasCapability(user, capability));
}

export function isAdminLike(user) {
  return hasAnyCapability(user, ["Admin", "HR"]);
}

export async function fetchCurrentUserProfile() {
  const response = await authFetch("/api/auth/me", {
    cache: "no-store"
  });

  if (response.status === 401) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || "Unable to load current user");
  }

  return payload;
}

export async function requireAuth(options = {}) {
  const { redirectTo = "login.html" } = options;
  const profile = await fetchCurrentUserProfile();
  if (!profile) {
    window.location.replace(redirectTo);
    return null;
  }
  return profile;
}

export async function redirectIfAuthenticated(target = "index.html") {
  try {
    const profile = await fetchCurrentUserProfile();
    if (profile) {
      window.location.replace(target);
      return true;
    }
  } catch (error) {
    console.warn("Auth pre-check skipped:", error);
  }
  return false;
}

export async function wireLogout(selectorOrElement, redirectTo = "login.html") {
  const element = typeof selectorOrElement === "string"
    ? document.querySelector(selectorOrElement)
    : selectorOrElement;

  if (!element) {
    return;
  }

  element.addEventListener("click", async () => {
    const originalText = element.innerHTML;
    element.textContent = "Wait...";

    try {
      await signOutUser();
      window.location.replace(redirectTo);
    } catch (error) {
      console.error("Logout failed:", error);
      element.innerHTML = originalText;
    }
  });
}
