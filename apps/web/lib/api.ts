'use client';

// ============================================================
// Cliente HTTP del web app.
//
// La sesión vive en cookies HttpOnly: el navegador la envía sola y el
// JavaScript NUNCA ve un token. Al 401 se intenta refrescar una vez (la
// cookie de refresco dura 7 días); si no se puede, se pide login.
// ============================================================

import type { AuthResponse, LoginCandidate, UserSummary } from '@nexo/contracts';

const API_BASE = '/api';

export class AuthRequiredError extends Error {
  constructor() {
    super('Sesión requerida');
    this.name = 'AuthRequiredError';
  }
}

// Nest devuelve `{ message: string | string[] }`; se muestra tal cual.
function messageOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join('. ');
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

async function parse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(messageOf(body, fallback));
  }
  return (await response.json()) as T;
}

export async function login(userId: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ userId, password }),
  });
  return parse<AuthResponse>(response, 'No se pudo iniciar sesión');
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
}

// Autocompletado del login (público): usuarios activos de Profit.
export async function searchLoginCandidates(q: string): Promise<LoginCandidate[]> {
  const response = await fetch(`${API_BASE}/auth/usuarios?q=${encodeURIComponent(q)}`, {
    credentials: 'include',
  });
  return parse<LoginCandidate[]>(response, 'No se pudo buscar usuarios');
}

async function tryRefresh(): Promise<boolean> {
  const response = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
  return response.ok;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const doFetch = (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });

  let response = await doFetch();
  if (response.status === 401 && (await tryRefresh())) {
    response = await doFetch();
  }
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(messageOf(body, `Error ${response.status}`));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// Usuario de la sesión (null si no hay sesión). Lo usa la navegación para
// mostrar módulos de administración.
export async function currentUser(): Promise<UserSummary | null> {
  try {
    return await apiFetch<UserSummary>('/auth/me');
  } catch {
    return null;
  }
}
