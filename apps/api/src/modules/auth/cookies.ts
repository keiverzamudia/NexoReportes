import type { CookieOptions, Request, Response } from 'express';

// Cookies de sesión sin dependencias extra: se leen del header `Cookie` y se
// escriben con la API de Express. La sesión NUNCA viaja en JavaScript.

export function readCookie(request: Request, name: string): string | undefined {
  const raw = request.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

const BASE: CookieOptions = { httpOnly: true, sameSite: 'lax', path: '/' };

export function setSessionCookie(response: Response, name: string, value: string, options: CookieOptions = {}): void {
  response.cookie(name, value, { ...BASE, ...options });
}

export function clearSessionCookie(response: Response, name: string, options: CookieOptions = {}): void {
  response.clearCookie(name, { ...BASE, ...options });
}
