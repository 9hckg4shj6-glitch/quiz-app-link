import type { AuthChangeEvent, User } from "@supabase/supabase-js";
import { supabase } from "./backend";
import type { AccountState, AuthProvider } from "./types";

export const LOCAL_DATA_OWNER_KEY = "local_data_owner_v1";
const PENDING_PROVIDER_KEY = "auth_pending_provider_v1";
const PENDING_ACTION_KEY = "auth_pending_action_v1";

export const socialAuthEnabled =
  String(import.meta.env.VITE_SOCIAL_AUTH_ENABLED ?? "false").toLowerCase() === "true";

let cachedState: AccountState = {
  status: supabase ? "loading" : "disabled",
  enabled: Boolean(supabase),
  socialEnabled: socialAuthEnabled,
  localOwnerId: getLocalDataOwner(),
  userId: null,
  email: null,
  displayName: null,
  providers: [],
};

function readLocal(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* noop */ }
}

function readSession(key: string): string {
  try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch { /* noop */ }
}

export function getOAuthRedirectUrl(
  origin = location.origin,
  baseUrl = import.meta.env.BASE_URL,
): string {
  const parsed = new URL(origin);
  const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
  return new URL(localHosts.has(parsed.hostname) ? "/" : baseUrl, parsed).href;
}

export function getLocalDataOwner(): string | null {
  return readLocal(LOCAL_DATA_OWNER_KEY) || null;
}

export function bindLocalDataOwner(userId: string): void {
  writeLocal(LOCAL_DATA_OWNER_KEY, userId);
}

export function clearLocalDataOwner(): void {
  writeLocal(LOCAL_DATA_OWNER_KEY, null);
}

export async function bindCurrentAccount(): Promise<AccountState> {
  const state = await refreshAccountState();
  if (state.userId && assessAccountBinding(state.userId) === "unbound") {
    bindLocalDataOwner(state.userId);
    return refreshAccountState();
  }
  return state;
}

export function assessAccountBinding(userId: string, owner = getLocalDataOwner()): "unbound" | "same" | "conflict" {
  if (!owner) return "unbound";
  return owner === userId ? "same" : "conflict";
}

function providersFor(user: User): AuthProvider[] {
  const values = (user.identities ?? []).map((identity) => identity.provider);
  return [...new Set(values.filter((value): value is AuthProvider =>
    value === "google" || value === "apple" || value === "email"))];
}

function nameFor(user: User): string | null {
  const meta = user.user_metadata ?? {};
  const value = meta.full_name ?? meta.name ?? meta.user_name;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getCachedAccountState(): AccountState {
  return { ...cachedState, providers: [...cachedState.providers] };
}

export function setAccountMigrationState(active: boolean): AccountState {
  if (cachedState.userId && (cachedState.status === "authenticated" || cachedState.status === "migrating")) {
    cachedState = { ...cachedState, status: active ? "migrating" : "authenticated" };
    window.dispatchEvent(new Event("study:auth-changed"));
  }
  return getCachedAccountState();
}

export async function refreshAccountState(): Promise<AccountState> {
  if (!supabase) {
    cachedState = { ...cachedState, status: "disabled", enabled: false, localOwnerId: getLocalDataOwner() };
    return getCachedAccountState();
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    cachedState = {
      status: "guest", enabled: true, socialEnabled: socialAuthEnabled,
      localOwnerId: getLocalDataOwner(),
      userId: null, email: null, displayName: null, providers: [],
    };
    return getCachedAccountState();
  }
  const user = data.user;
  const conflict = assessAccountBinding(user.id) === "conflict";
  cachedState = {
    status: conflict ? "conflict" : "authenticated",
    enabled: true,
    socialEnabled: socialAuthEnabled,
    localOwnerId: getLocalDataOwner(),
    userId: user.id,
    email: user.email ?? null,
    displayName: nameFor(user),
    providers: providersFor(user),
  };
  return getCachedAccountState();
}

function rememberPending(provider: Exclude<AuthProvider, "email">, action: "signin" | "link"): void {
  writeSession(PENDING_PROVIDER_KEY, provider);
  writeSession(PENDING_ACTION_KEY, action);
}

export async function signInWithProvider(provider: "google" | "apple"): Promise<void> {
  if (!supabase) throw new Error("アカウント機能は現在利用できません");
  if (!socialAuthEnabled) throw new Error("ソーシャルログインは現在準備中です");
  rememberPending(provider, "signin");
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: getOAuthRedirectUrl() },
  });
  if (error) {
    writeSession(PENDING_PROVIDER_KEY, null);
    writeSession(PENDING_ACTION_KEY, null);
    throw error;
  }
}

export async function linkProvider(provider: "google" | "apple"): Promise<void> {
  if (!supabase) throw new Error("アカウント機能は現在利用できません");
  if (!socialAuthEnabled) throw new Error("ソーシャルログインは現在準備中です");
  const state = await refreshAccountState();
  if (state.status !== "authenticated") throw new Error("先にログインしてください");
  if (state.providers.includes(provider)) return;
  rememberPending(provider, "link");
  const { error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo: getOAuthRedirectUrl() },
  });
  if (error) {
    writeSession(PENDING_PROVIDER_KEY, null);
    writeSession(PENDING_ACTION_KEY, null);
    throw error;
  }
}

export function translateAuthError(message: string): string {
  const value = decodeURIComponent(message.replace(/\+/g, " "));
  if (/provider.*not enabled|unsupported provider/i.test(value)) return "このログイン方法はまだ有効化されていません";
  if (/identity.*already.*linked|already registered|already exists/i.test(value)) return "このログイン方法は別のアカウントで使用されています";
  if (/access_denied|cancel|denied/i.test(value)) return "ログインがキャンセルされました";
  return value || "ログインに失敗しました";
}

export async function consumeAuthCallbackMessage(): Promise<string | null> {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
  const error = search.get("error_description") ?? hash.get("error_description") ?? search.get("error") ?? hash.get("error");
  const provider = readSession(PENDING_PROVIDER_KEY);
  const action = readSession(PENDING_ACTION_KEY);
  const hasAuthParams = search.has("code") || search.has("error_code")
    || hash.has("access_token") || hash.has("refresh_token") || hash.has("error_code");
  if (!error && !provider && !hasAuthParams) return null;

  writeSession(PENDING_PROVIDER_KEY, null);
  writeSession(PENDING_ACTION_KEY, null);
  const state = await refreshAccountState();
  try { history.replaceState(history.state, "", getOAuthRedirectUrl()); } catch { /* noop */ }
  if (error) return translateAuthError(error);
  if (state.status === "conflict") return "別のアカウントの端末データを検出しました";
  const label = provider === "apple" ? "Apple" : provider === "google" ? "Google" : "メール";
  return action === "link" ? `${label}をログイン方法に追加しました` : `${label}でログインしました`;
}

export async function signOutAccount(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  await refreshAccountState();
}

export async function resolveAccountSwitch(action: "replace" | "cancel"): Promise<AccountState> {
  const state = await refreshAccountState();
  if (state.status !== "conflict" || !state.userId) return state;
  if (action === "cancel") {
    await signOutAccount();
    return getCachedAccountState();
  }
  bindLocalDataOwner(state.userId);
  return refreshAccountState();
}

export function startAccountAuth(): void {
  if (!supabase) return;
  const notify = () => window.dispatchEvent(new Event("study:auth-changed"));
  void refreshAccountState().then(notify);
  supabase.auth.onAuthStateChange((_event: AuthChangeEvent) => {
    queueMicrotask(() => void refreshAccountState().then(notify));
  });
}
