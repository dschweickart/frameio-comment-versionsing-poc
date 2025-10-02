# Frame.io Authentication Guide

**Complete reference for OAuth implementation, token management, and server-side authentication**

---

## Table of Contents

1. [Overview](#overview)
2. [Adobe Developer Console Setup](#adobe-developer-console-setup)
3. [Environment Configuration](#environment-configuration)
4. [OAuth 2.0 + PKCE Implementation](#oauth-20--pkce-implementation)
5. [Token Storage Strategy](#token-storage-strategy)
6. [Token Refresh System](#token-refresh-system)
7. [API Client Usage](#api-client-usage)
8. [Security Considerations](#security-considerations)
9. [Testing & Troubleshooting](#testing--troubleshooting)

---

## Overview

### Authentication Architecture

This application uses **Adobe Identity Management System (IMS)** for Frame.io API access with a dual-storage token strategy:

- **Session Cookies**: For browser-based user sessions
- **Database Storage**: For server-side operations (webhooks, background jobs)

```mermaid
graph TB
    A[User Login] --> B[OAuth Flow]
    B --> C[Get Tokens]
    C --> D[Save to Session Cookie]
    C --> E[Save to Database]
    D --> F[Frontend API Calls]
    E --> G[Webhook Processing]
    E --> H[Server-Side Jobs]
```

### Key Features

- ✅ OAuth 2.0 with PKCE (S256)
- ✅ Automatic token refresh (3 paths)
- ✅ Session + Database token storage
- ✅ Server-side webhook support
- ✅ Secure credential management

---

## Adobe Developer Console Setup

### Step 1: Create Project

1. Navigate to [Adobe Developer Console](https://developer.adobe.com/console)
2. Sign in with Adobe credentials
3. Click **"Create new project"**

### Step 2: Add Frame.io API

1. Click **"Add API"**
2. Select **"Frame.io API"**
3. Choose **"OAuth Web App"** credential type

### Step 3: Configure OAuth Credentials

**Application Settings:**
```json
{
  "application_name": "Frame.io Comment Versioning POC",
  "description": "AI-powered comment transfer between video versions",
  "platform": "Web",
  "default_redirect_uri": "https://localhost:3000/api/auth/callback",
  "redirect_uri_pattern": "https://*.vercel.app/api/auth/callback"
}
```

**Required Scopes:**
```
offline_access
profile
email
additional_info.roles
openid
```

**PKCE Configuration:**
- ✅ PKCE Enabled (automatic for Web Apps)
- ✅ Code Challenge Method: S256
- ⚠️ HTTPS Required (even for localhost)

---

## Environment Configuration

### Local Development Setup

Create `.env.local`:

```bash
# Adobe OAuth Configuration
ADOBE_CLIENT_ID="your_client_id"
ADOBE_CLIENT_SECRET="your_client_secret"

# OAuth URLs (Adobe IMS)
ADOBE_AUTH_URL="https://ims-na1.adobelogin.com/ims/authorize/v2"
ADOBE_TOKEN_URL="https://ims-na1.adobelogin.com/ims/token/v3"

# Application URLs (HTTPS required)
NEXT_PUBLIC_BASE_URL="https://localhost:3000"
NEXTAUTH_URL="https://localhost:3000"
NEXTAUTH_SECRET="generate_random_32_char_secret"

# Frame.io API (V4)
FRAMEIO_API_BASE_URL="https://api.frame.io/v4"

# Database (Neon PostgreSQL)
DATABASE_URL="postgresql://user:password@host:port/database"
```

### HTTPS Development Server

Adobe OAuth requires HTTPS even for localhost:

```bash
# Generate self-signed SSL certificates
npm run setup:certs

# Start HTTPS dev server
npm run dev:https
```

---

## OAuth 2.0 + PKCE Implementation

### Flow Overview

```typescript
// 1. Generate PKCE parameters
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto
  .createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');
const state = crypto.randomBytes(32).toString('base64url');

// 2. Build authorization URL
const authUrl = `${ADOBE_AUTH_URL}?${new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: CALLBACK_URL,
  scope: 'offline_access,profile,email,additional_info.roles,openid',
  response_type: 'code',
  code_challenge: codeChallenge,
  code_challenge_method: 'S256',
  state: state
})}`;

// 3. Exchange code for tokens
const tokens = await fetch(ADOBE_TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code: authorizationCode,
    redirect_uri: CALLBACK_URL,
    code_verifier: codeVerifier
  })
});
```

### API Routes

```
src/app/api/auth/
├── login/route.ts      # Initiate OAuth flow
├── callback/route.ts   # Handle OAuth callback & save tokens
├── me/route.ts         # Get user info + refresh if needed
├── refresh/route.ts    # Explicit token refresh
└── logout/route.ts     # Clear session + cleanup
```

### Session Management

**File**: `src/lib/auth/crypto.ts`

```typescript
import { SignJWT, jwtVerify } from 'jose';

// Encrypt session data into JWT
export async function encrypt(payload: SessionData) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);
}

// Decrypt and verify session JWT
export async function decrypt(token: string) {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ['HS256'],
  });
  return payload;
}

// Get current session from cookie
export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('session')?.value;
  if (!sessionCookie) return null;
  return decrypt(sessionCookie);
}
```

---

## Token Storage Strategy

### Why Dual Storage?

**Problem**: Webhooks and background jobs run server-side without user session cookies.

**Solution**: Store tokens in **both** places:

| Storage | Use Case | Access Method |
|---------|----------|---------------|
| **Session Cookie** | Browser requests | `FrameioClient.fromSession()` |
| **PostgreSQL Database** | Webhooks, server jobs | `FrameioClient.fromAccountId(accountId)` |

### Database Schema

**File**: `src/lib/db/migrations/002_add_user_tokens.sql`

```sql
CREATE TABLE user_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  account_id VARCHAR(255),
  email VARCHAR(255),
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_tokens_account_id ON user_tokens(account_id);
```

### Token Storage Functions

**File**: `src/lib/auth/token-storage.ts`

```typescript
// Save or update tokens (upsert by user_id)
await saveUserTokens(userId, tokens, {
  accountId, email, name
});

// Get tokens by user ID
const tokens = await getUserTokens(userId);

// Get tokens by account ID (for webhooks)
const tokens = await getUserTokensByAccountId(accountId);

// Check if token needs refresh
const needsRefresh = isTokenExpired(expiresAt, thresholdMinutes);
```

### When Tokens Are Saved

#### 1. OAuth Callback (Initial Login)

**File**: `src/app/api/auth/callback/route.ts`

```typescript
// Exchange code for tokens
const tokens = await exchangeCodeForTokens(code, codeVerifier, redirectUri);
const userInfo = await getUserInfo(tokens.access_token);

// ✅ Save to DATABASE
await saveUserTokens(userId, tokens, {
  accountId, email, name
});

// ✅ Save to SESSION COOKIE
await setSession({ user, tokens });
```

#### 2. Session Refresh

**File**: `src/app/api/auth/me/route.ts`

```typescript
if (shouldRefresh) {
  const newTokens = await refreshAccessToken(session.tokens.refresh_token);
  
  // ✅ Update SESSION COOKIE
  session.tokens = newTokens;
  await setSession(session);
  
  // ✅ Update DATABASE (NEW FIX!)
  await saveUserTokens(session.user.id, newTokens, {
    email: session.user.email,
    name: session.user.name,
  });
}
```

#### 3. Server-Side Refresh

**File**: `src/lib/frameio-client.ts`

```typescript
static async fromAccountId(accountId: string) {
  const userToken = await getUserTokensByAccountId(accountId);
  
  if (isTokenExpired(userToken.expiresAt)) {
    const newTokens = await refreshAccessToken(userToken.refreshToken);
    
    // ✅ Update DATABASE
    await saveUserTokens(userId, newTokens, {...});
  }
  
  return new FrameioClient(...);
}
```

---

## Token Refresh System

### Three Refresh Paths (All Keep DB in Sync)

#### Path 1: Session-Based Refresh (Frontend)

**Trigger**: User browses app, `/api/auth/me` called automatically  
**Frequency**: On page load, typically every few minutes  
**Threshold**: Refreshes if token expires within **5 minutes**  
**Updates**: ✅ Session cookie + ✅ Database

```typescript
// Happens in: src/app/api/auth/me/route.ts
const expiresAt = session.tokens.obtained_at + (session.tokens.expires_in * 1000);
const shouldRefresh = Date.now() >= (expiresAt - 300000); // 5 min threshold

if (shouldRefresh) {
  const newTokens = await refreshAccessToken(session.tokens.refresh_token);
  
  // Update both storage locations
  session.tokens = newTokens;
  await setSession(session);
  await saveUserTokens(session.user.id, newTokens, {...});
}
```

#### Path 2: Explicit Refresh (Frontend)

**Trigger**: Manual call to `/api/auth/refresh`  
**Frequency**: On-demand (rarely used)  
**Updates**: ✅ Session cookie + ✅ Database

```typescript
// POST /api/auth/refresh
const newTokens = await refreshAccessToken(session.tokens.refresh_token);
await setSession({ ...session, tokens: newTokens });
await saveUserTokens(session.user.id, newTokens, {...});
```

#### Path 3: Server-Side Refresh (Webhooks)

**Trigger**: `FrameioClient.fromAccountId()` called  
**Frequency**: Each webhook or server-side job  
**Threshold**: Refreshes if token expires within **5 minutes**  
**Updates**: ✅ Database only (no session)

```typescript
// Happens in: src/lib/frameio-client.ts
const client = await FrameioClient.fromAccountId(accountId);
// Automatically checks expiry and refreshes if needed
```

### Token Lifecycle Flow

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant API
    participant Database
    participant Adobe
    participant Webhook

    Note over User,Database: Initial Login
    User->>API: OAuth Login
    API->>Adobe: Exchange code for tokens
    Adobe->>API: Access + Refresh tokens
    API->>Database: Save tokens
    API->>Browser: Set session cookie
    
    Note over User,Database: User Browsing (5 minutes later)
    Browser->>API: GET /api/auth/me
    API->>API: Check expiry (5 min threshold)
    API->>Adobe: Refresh token
    Adobe->>API: New access token
    API->>Database: Update tokens ✅
    API->>Browser: Update session cookie ✅
    
    Note over User,Webhook: Hours Later - Webhook Fires
    Webhook->>API: POST /webhooks/frameio
    API->>Database: Get tokens via account_id
    API->>API: Check expiry
    Note over API: Tokens are fresh! ✅
    API->>Webhook: Process with valid tokens
```

### Why This Matters

**Before the Fix:**
- Session tokens refreshed ✅
- Database tokens stayed stale ❌
- Webhooks could fail hours later ❌

**After the Fix:**
- Session tokens refreshed ✅
- Database tokens also refreshed ✅
- Webhooks always have fresh tokens ✅

---

## API Client Usage

### FrameioClient Creation

**File**: `src/lib/frameio-client.ts`

#### Frontend (Browser Context)

```typescript
// Uses session cookies
const client = await FrameioClient.fromSession();
if (!client) {
  // User not authenticated, redirect to login
  redirect('/api/auth/login');
}

// Make API calls
const user = await client.getCurrentUser();
const accounts = await client.getAccounts();
```

#### Backend (Webhook/Server Context)

```typescript
// Uses database tokens via account ID
const client = await FrameioClient.fromAccountId(accountId);
if (!client) {
  return NextResponse.json(
    { error: 'No authentication tokens found' },
    { status: 401 }
  );
}

// Make API calls (tokens auto-refresh if needed)
const file = await client.getFile(accountId, fileId);
const comments = await client.getFileComments(accountId, fileId);
```

### Webhook Example

**File**: `src/app/api/webhooks/frameio/route.ts`

```typescript
export async function POST(request: NextRequest) {
  const payload = await request.json();
  const accountId = payload.account_id;
  const fileId = payload.resource.id;
  
  // Get authenticated client from database tokens
  const client = await FrameioClient.fromAccountId(accountId);
  if (!client) {
    return NextResponse.json({ error: 'Auth required' }, { status: 401 });
  }
  
  // Process webhook with valid authentication
  const file = await client.getFile(accountId, fileId);
  const versionStack = await client.getVersionStack(accountId, file.parent_id);
  
  // Start comment transfer job...
  return NextResponse.json({ success: true });
}
```

### Automatic Token Refresh

The `FrameioClient` automatically refreshes tokens before they expire:

```typescript
private async ensureValidToken() {
  const now = Date.now();
  const refreshThreshold = 60000; // 1 minute before expiry
  
  if (now >= (this.expiresAt - refreshThreshold)) {
    const newTokens = await refreshAccessToken(this.refreshToken);
    this.accessToken = newTokens.access_token;
    this.refreshToken = newTokens.refresh_token;
    this.expiresAt = newTokens.obtained_at + (newTokens.expires_in * 1000);
  }
}
```

---

## Security Considerations

### PKCE Implementation

✅ **Code Challenge Method**: S256 (SHA-256)  
✅ **Code Verifier**: 32 random bytes, base64url-encoded  
✅ **State Parameter**: CSRF protection with 32 random bytes

```typescript
// Generate cryptographically secure PKCE parameters
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto
  .createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');
```

### Token Security

| Security Feature | Implementation |
|-----------------|----------------|
| **Storage** | Session: Encrypted JWT cookies<br>Database: Encrypted at rest (Neon) |
| **Transmission** | HTTPS only, even for localhost |
| **Cookies** | httpOnly, secure, sameSite=lax |
| **Expiration** | Access token: 24 hours<br>Refresh token: Long-lived |
| **Refresh Strategy** | Proactive (5 min before expiry) |

### Production Recommendations

1. **Token Encryption in DB**
   ```typescript
   // Consider encrypting tokens before storing
   const encrypted = await encrypt(token, DB_ENCRYPTION_KEY);
   await saveToDatabase(encrypted);
   ```

2. **Token Cleanup on Logout**
   ```typescript
   // Clear both session and database
   await deleteUserTokens(userId);
   await clearSessionCookie();
   ```

3. **Expired Token Cleanup Job**
   ```sql
   -- Run periodically (e.g., cron job)
   DELETE FROM user_tokens 
   WHERE expires_at < NOW() - INTERVAL '30 days';
   ```

4. **Security Headers**
   ```typescript
   // next.config.js
   headers: [
     { key: 'X-Frame-Options', value: 'DENY' },
     { key: 'X-Content-Type-Options', value: 'nosniff' },
     { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
   ]
   ```

---

## Testing & Troubleshooting

### Test OAuth Flow

```bash
# 1. Start HTTPS dev server
npm run dev:https

# 2. Navigate to app
open https://localhost:3000

# 3. Accept self-signed cert warning

# 4. Click "Sign in with Frame.io"

# 5. Complete OAuth flow

# 6. Verify authenticated state
```

### Test Token Refresh

```bash
# 1. Login to the app

# 2. Wait 5+ minutes

# 3. Reload page (triggers /api/auth/me)

# 4. Check logs for:
# "Token refreshed and saved to both session and database"

# 5. Verify in database:
SELECT user_id, email, expires_at, updated_at
FROM user_tokens
ORDER BY updated_at DESC;
```

### Test Webhook Authentication

```bash
# 1. Login to app (saves tokens to DB)

# 2. Trigger Frame.io webhook

# 3. Check webhook handler logs:
# "📡 Creating Frame.io client from database tokens..."
# "✅ Client created successfully!"

# 4. Verify API calls succeed
```

### Common Issues

#### Issue: "No authentication tokens found for account"

**Cause**: User hasn't logged in, or tokens weren't saved to database

**Fix**:
1. Have user sign out completely
2. Sign in again (this saves tokens to DB)
3. Verify tokens in database:
   ```sql
   SELECT * FROM user_tokens WHERE account_id = 'your_account_id';
   ```

#### Issue: "Token expired" errors on webhook

**Cause**: Database tokens were stale (should be fixed now)

**Fix**:
1. Verify fix is deployed (check `src/app/api/auth/me/route.ts`)
2. Have user reload app (triggers token refresh)
3. Verify `updated_at` in database is recent

#### Issue: "Failed to refresh token"

**Cause**: Refresh token is invalid or expired

**Fix**:
1. User must sign out and sign in again
2. This gets a new refresh token from Adobe
3. Check Adobe Developer Console for any issues

#### Issue: HTTPS certificate errors in development

**Cause**: Self-signed certificate

**Fix**:
```bash
# Regenerate certificates
npm run setup:certs

# Or disable SSL verification (not recommended)
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev
```

### Debug Logging

Enable verbose auth logging:

```typescript
// In src/lib/auth/oauth.ts
console.log('🔄 Refreshing token...');
console.log('Token expires at:', new Date(expiresAt));
console.log('Current time:', new Date());
console.log('Should refresh:', shouldRefresh);
```

### Verify Token Freshness

```sql
-- Check all tokens and their status
SELECT 
  user_id,
  email,
  expires_at,
  updated_at,
  EXTRACT(EPOCH FROM (expires_at - NOW())) / 3600 as hours_until_expiry,
  CASE 
    WHEN expires_at < NOW() THEN '❌ EXPIRED'
    WHEN expires_at < NOW() + INTERVAL '5 minutes' THEN '⚠️ EXPIRING SOON'
    ELSE '✅ VALID'
  END as status
FROM user_tokens
ORDER BY updated_at DESC;
```

---

## Quick Reference

### Environment Variables

```bash
# Required
ADOBE_CLIENT_ID=              # From Adobe Developer Console
ADOBE_CLIENT_SECRET=          # From Adobe Developer Console
ADOBE_AUTH_URL=               # https://ims-na1.adobelogin.com/ims/authorize/v2
ADOBE_TOKEN_URL=              # https://ims-na1.adobelogin.com/ims/token/v3
NEXT_PUBLIC_BASE_URL=         # https://localhost:3000 or production URL
NEXTAUTH_SECRET=              # Random 32-character string
FRAMEIO_API_BASE_URL=         # https://api.frame.io/v4
DATABASE_URL=                 # PostgreSQL connection string
```

### Key Files

```
src/
├── app/api/auth/
│   ├── login/route.ts         # Start OAuth
│   ├── callback/route.ts      # Handle callback + save tokens
│   ├── me/route.ts            # Get user + refresh tokens
│   ├── refresh/route.ts       # Manual refresh
│   └── logout/route.ts        # Clear session
├── lib/
│   ├── auth/
│   │   ├── crypto.ts          # JWT session encryption
│   │   ├── oauth.ts           # OAuth + token refresh
│   │   ├── token-storage.ts   # Database token functions
│   │   └── context.tsx        # React auth provider
│   └── frameio-client.ts      # API client with auto-refresh
└── lib/db/migrations/
    └── 002_add_user_tokens.sql # Token storage schema
```

### Common Commands

```bash
# Development
npm run setup:certs    # Generate SSL certificates
npm run dev:https      # Start HTTPS dev server

# Database
npm run db:studio      # Open Drizzle Studio
npm run db:push        # Push schema changes

# Testing
curl https://localhost:3000/api/auth/me  # Check auth status
```

---

**Last Updated**: October 2, 2025  
**Status**: ✅ Production Ready  
**Related Docs**: `PHASE2_SUMMARY.md` (high-level overview)

