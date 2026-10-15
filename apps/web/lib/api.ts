'use client';

// ============================================================
// Cliente HTTP del web app: adjunta el JWT y reintenta UNA vez
// con /auth/refresh si el access token expiró (401).
// Sin sesión válida lanza AuthRequiredError (la UI muestra login).
// ============================================================

import { AuthResponse } from '@nexo/contracts';

const API_BASE = '/api';
const SESSION_KEY = 'nexo.session';

export interface Session {
  accessToken: string;
  refreshToken: string;
}

export class AuthRequiredError extends Error {
  constructor() {
    super('Sesión requerida');
    this.name = 'AuthRequiredError';
  }
}

export function loadSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    return parsed.accessToken && parsed.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'No se pudo iniciar sesión');
  }
  const auth = (await response.json()) as AuthResponse;
  saveSession({ accessToken: auth.accessToken, refreshToken: auth.refreshToken });
  return auth;
}

async function tryRefresh(): Promise<boolean> {
  const session = loadSession();
  if (!session) return false;
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  if (!response.ok) {
    clearSession();
    return false;
  }
  const auth = (await response.json()) as AuthResponse;
  saveSession({ accessToken: auth.accessToken, refreshToken: auth.refreshToken });
  return true;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const session = loadSession();
    return fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  };

  let response = await doFetch();
  if (response.status === 401 && (await tryRefresh())) {
    response = await doFetch();
  }
  if (response.status === 401) {
    clearSession();
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Error ${response.status}`);
  }
  return (await response.json()) as T;
}
