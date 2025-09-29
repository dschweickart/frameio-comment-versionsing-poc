import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || 'fallback-secret-key-for-development-only');

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  obtained_at: number;
}

export interface SessionData {
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url?: string;
  };
  tokens: TokenData;
  [key: string]: unknown; // Index signature for JWT compatibility
}

// Encrypt session data into JWT
export async function encrypt(payload: SessionData): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);
}

// Decrypt JWT back to session data
export async function decrypt(input: string): Promise<SessionData> {
  const { payload } = await jwtVerify(input, secret, {
    algorithms: ['HS256'],
  });
  return payload as SessionData;
}

// Generate cryptographically secure random string for PKCE
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Generate code challenge from verifier
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Generate random state for CSRF protection
export function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Get session from cookies
export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('session');
  
  if (!sessionCookie?.value) {
    return null;
  }

  try {
    return await decrypt(sessionCookie.value);
  } catch (error) {
    console.error('Failed to decrypt session:', error);
    return null;
  }
}

// Set session in cookies
export async function setSession(sessionData: SessionData): Promise<void> {
  const cookieStore = await cookies();
  const encrypted = await encrypt(sessionData);
  
  cookieStore.set('session', encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60, // 24 hours
    path: '/'
  });
}

// Clear session
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete('session');
}
