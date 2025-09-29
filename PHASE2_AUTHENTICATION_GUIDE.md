# Phase 2: Frame.io OAuth Authentication Implementation Guide

## Overview

Phase 2 focuses on implementing Adobe OAuth 2.0 authentication for Frame.io API access in our Next.js web application. Frame.io uses Adobe's Identity Management System (IMS), requiring OAuth 2.0 with PKCE flow for secure authentication.

## Adobe Developer Console Configuration

### Step 1: Create Adobe Developer Project

1. **Access Adobe Developer Console**
   - Navigate to [Adobe Developer Console](https://developer.adobe.com/console)
   - Sign in with your Adobe credentials
   - Click "Create new project"

2. **Add Frame.io API**
   - Click "Add API" in your new project
   - Find and select "Frame.io API" 
   - Choose "OAuth Web App" as the credential type

3. **Configure OAuth Web App Credential**
   ```json
   {
     "application_name": "Frame.io Comment Versioning POC",
     "description": "AI-powered comment transfer between video versions",
     "platform": "Web",
     "default_redirect_uri": "https://localhost:3000/api/auth/callback",
     "redirect_uri_pattern": "https://*.vercel.app/api/auth/callback"
   }
   ```

   **⚠️ Important**: Adobe requires HTTPS even for localhost development!

4. **Required Scopes**
   ```
   additional_info.roles
   openid
   profile
   offline_access
   email
   ```

5. **PKCE Configuration**
   - Enable PKCE (Proof Key for Code Exchange)
   - Code challenge method: S256
   - This is automatically enabled for Web App credentials

### Step 2: Environment Configuration

Create/update `.env.local`:
```bash
# Adobe OAuth Configuration
ADOBE_CLIENT_ID=2580dda8fc9f49c3ad7fde74446ef5be
ADOBE_CLIENT_SECRET=p8e-UH3AK1NdU-2qDHKpDw8rRrKTwmnsA2B

# OAuth URLs
ADOBE_AUTH_URL=https://ims-na1.adobelogin.com/ims/authorize/v2
ADOBE_TOKEN_URL=https://ims-na1.adobelogin.com/ims/token/v3

# Application URLs (HTTPS required even for localhost)
NEXT_PUBLIC_BASE_URL=https://localhost:3000
NEXTAUTH_URL=https://localhost:3000
NEXTAUTH_SECRET=your_random_secret_key

# Frame.io API
FRAMEIO_API_BASE_URL=https://api.frame.io/v4
```

## Technical Implementation

### OAuth 2.0 with PKCE Flow

#### 1. PKCE Security Parameters
```typescript
// Generate code verifier (32 random bytes)
const codeVerifier = crypto.randomBytes(32).toString('base64url');

// Generate code challenge (SHA256 hash of verifier)
const codeChallenge = crypto
  .createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');

// Generate state for CSRF protection
const state = crypto.randomBytes(32).toString('base64url');
```

#### 2. Authorization Request
```typescript
const authParams = new URLSearchParams({
  client_id: process.env.ADOBE_CLIENT_ID!,
  redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/callback`,
  scope: 'additional_info.roles,openid,profile,offline_access,email',
  response_type: 'code',
  code_challenge: codeChallenge,
  code_challenge_method: 'S256',
  state: state
});

const authUrl = `${process.env.ADOBE_AUTH_URL}?${authParams.toString()}`;
```

#### 3. Token Exchange
```typescript
const tokenResponse = await fetch(process.env.ADOBE_TOKEN_URL!, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.ADOBE_CLIENT_ID!,
    client_secret: process.env.ADOBE_CLIENT_SECRET!,
    code: authorizationCode,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/callback`,
    code_verifier: codeVerifier
  })
});
```

### API Routes Structure

```
src/app/api/auth/
├── login/route.ts          # Initiate OAuth flow
├── callback/route.ts       # Handle OAuth callback
├── refresh/route.ts        # Token refresh endpoint
├── logout/route.ts         # Clear session
└── me/route.ts            # Get current user info
```

### Session Management

#### Secure Token Storage
```typescript
// Use encrypted cookies for token storage
import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET);

export async function encrypt(payload: any) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);
}

export async function decrypt(input: string) {
  const { payload } = await jwtVerify(input, secret, {
    algorithms: ['HS256'],
  });
  return payload;
}
```

#### Token Refresh Logic
```typescript
export async function refreshAccessToken(refreshToken: string) {
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

  const tokens = await response.json();
  
  if (!response.ok) {
    throw new Error('Failed to refresh token');
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? refreshToken,
    expires_in: tokens.expires_in,
    obtained_at: Date.now()
  };
}
```

## Frame.io API Client

### Authenticated API Client
```typescript
export class FrameioClient {
  private accessToken: string;
  private refreshToken: string;
  private expiresAt: number;

  constructor(tokens: TokenData) {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    this.expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
  }

  private async ensureValidToken() {
    if (Date.now() >= this.expiresAt - 60000) { // Refresh 1 min before expiry
      const newTokens = await refreshAccessToken(this.refreshToken);
      this.accessToken = newTokens.access_token;
      this.refreshToken = newTokens.refresh_token;
      this.expiresAt = newTokens.obtained_at + (newTokens.expires_in * 1000);
    }
  }

  async apiRequest(endpoint: string, options: RequestInit = {}) {
    await this.ensureValidToken();

    const response = await fetch(`${process.env.FRAMEIO_API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Frame.io API error: ${response.status}`);
    }

    return response.json();
  }

  // Frame.io API methods
  async getCurrentUser() {
    return this.apiRequest('/me');
  }

  async getAccounts() {
    return this.apiRequest('/accounts');
  }

  async getProjects(accountId: string) {
    return this.apiRequest(`/accounts/${accountId}/projects`);
  }

  async getAssets(projectId: string) {
    return this.apiRequest(`/projects/${projectId}/assets`);
  }

  async getComments(assetId: string) {
    return this.apiRequest(`/assets/${assetId}/comments`);
  }

  async createComment(assetId: string, commentData: any) {
    return this.apiRequest(`/assets/${assetId}/comments`, {
      method: 'POST',
      body: JSON.stringify(commentData)
    });
  }
}
```

## UI Components

### Authentication Hook
```typescript
'use client';

import { createContext, useContext, useEffect, useState } from 'react';

interface User {
  id: string;
  name: string;
  email: string;
  avatar_url?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch('/api/auth/me');
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const login = () => {
    window.location.href = '/api/auth/login';
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
```

### Login Component
```typescript
'use client';

import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

export function LoginButton() {
  const { user, loading, login, logout } = useAuth();

  if (loading) {
    return <div className="animate-pulse bg-gray-200 h-10 w-24 rounded"></div>;
  }

  if (user) {
    return (
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {user.avatar_url && (
            <img 
              src={user.avatar_url} 
              alt={user.name}
              className="w-8 h-8 rounded-full"
            />
          )}
          <span className="text-sm font-medium">{user.name}</span>
        </div>
        <Button onClick={logout} variant="outline">
          Sign Out
        </Button>
      </div>
    );
  }

  return (
    <Button onClick={login} className="bg-blue-600 hover:bg-blue-700">
      Sign in with Frame.io
    </Button>
  );
}
```

## Security Considerations

### 1. PKCE Implementation
- Always use S256 code challenge method
- Generate cryptographically secure random code verifiers
- Validate state parameter to prevent CSRF attacks

### 2. Token Security
- Store tokens in secure, httpOnly cookies
- Implement proper token refresh logic
- Clear all tokens on logout
- Use HTTPS in production

### 3. Error Handling
```typescript
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

export function handleAuthError(error: any) {
  if (error.code === 'invalid_grant') {
    // Refresh token expired, require re-authentication
    return { redirect: '/login' };
  }
  
  if (error.code === 'access_denied') {
    // User denied authorization
    return { error: 'Authentication was cancelled' };
  }

  // Generic error handling
  console.error('Auth error:', error);
  return { error: 'Authentication failed' };
}
```

## Testing Strategy

### 1. OAuth Flow Testing
- Test authorization URL generation
- Verify PKCE parameter generation
- Test callback handling with valid/invalid codes
- Test token refresh functionality

### 2. API Client Testing
- Test authenticated requests
- Test automatic token refresh
- Test error handling and retries
- Test rate limiting compliance

### 3. UI Testing
- Test login/logout flows
- Test protected route access
- Test authentication state management
- Test error state handling

## Deployment Considerations

### Environment Variables
Ensure all required environment variables are set in production:
- `ADOBE_CLIENT_ID`
- `ADOBE_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `NEXT_PUBLIC_BASE_URL`

### Redirect URI Configuration
Update Adobe Developer Console with production redirect URIs:
- `https://your-domain.vercel.app/api/auth/callback`

### Security Headers
Configure appropriate security headers in `next.config.js`:
```typescript
const nextConfig = {
  async headers() {
    return [
      {
        source: '/api/auth/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};
```

## Next Steps

1. ✅ Configure Adobe Developer Console
2. ⏳ Implement OAuth API routes
3. ⏳ Build Frame.io API client
4. ⏳ Create authentication UI
5. ⏳ Test end-to-end authentication flow
6. ⏳ Deploy and configure production environment

---

**Document Version**: 1.0  
**Last Updated**: September 29, 2025  
**Phase**: 2 - Authentication Implementation
