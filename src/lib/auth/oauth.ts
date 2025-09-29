import { TokenData } from './crypto';

export class AuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public status?: number
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// Refresh access token using refresh token
export async function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  const response = await fetch(process.env.ADOBE_TOKEN_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.ADOBE_CLIENT_ID!,
      client_secret: process.env.ADOBE_CLIENT_SECRET!,
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new AuthError(
      error.error_description || 'Failed to refresh token',
      error.error || 'refresh_failed',
      response.status
    );
  }

  const tokens = await response.json();
  
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? refreshToken, // Keep old refresh token if new one not provided
    expires_in: tokens.expires_in,
    obtained_at: Date.now()
  };
}

// Exchange authorization code for tokens
export async function exchangeCodeForTokens(
  code: string, 
  codeVerifier: string,
  redirectUri: string
): Promise<TokenData> {
  const response = await fetch(process.env.ADOBE_TOKEN_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.ADOBE_CLIENT_ID!,
      client_secret: process.env.ADOBE_CLIENT_SECRET!,
      code: code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new AuthError(
      error.error_description || 'Failed to exchange code for tokens',
      error.error || 'code_exchange_failed',
      response.status
    );
  }

  const tokens = await response.json();
  
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    obtained_at: Date.now()
  };
}

// Get user info from Frame.io API
export async function getUserInfo(accessToken: string): Promise<any> {
  const response = await fetch(`${process.env.FRAMEIO_API_BASE_URL}/me`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new AuthError(
      'Failed to get user info',
      'user_info_failed',
      response.status
    );
  }

  return response.json();
}

// Build authorization URL
export function buildAuthUrl(
  codeChallenge: string, 
  state: string, 
  redirectUri: string
): string {
  const params = new URLSearchParams({
    client_id: process.env.ADOBE_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: 'offline_access,profile,email,additional_info.roles,openid',
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: state
  });

  return `${process.env.ADOBE_AUTH_URL}?${params.toString()}`;
}

// Handle auth errors
export function handleAuthError(error: any): { error?: string; redirect?: string } {
  console.error('Auth error:', error);

  if (error instanceof AuthError) {
    if (error.code === 'invalid_grant') {
      // Refresh token expired, require re-authentication
      return { redirect: '/api/auth/login' };
    }
    
    if (error.code === 'access_denied') {
      // User denied authorization
      return { error: 'Authentication was cancelled by user' };
    }

    return { error: error.message };
  }

  // Generic error handling
  return { error: 'Authentication failed. Please try again.' };
}
