# Token Storage Implementation: Enabling Server-Side Authentication

## Problem

When Frame.io webhooks trigger server-side processing, we need Frame.io API access but don't have user session cookies available. We need a way for server-side functions to authenticate with Frame.io API.

## Solution

**Store OAuth tokens in the database** so server-side functions can access them using the account ID from the webhook payload.

## Implementation Details

### 1. Database Schema Addition

**New Table: `user_tokens`**

```sql
CREATE TABLE user_tokens (
  id UUID PRIMARY KEY,
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
```

**Indexes:**
- `user_id` - Primary lookup key
- `account_id` - For webhook lookups

**Migration:** `src/lib/db/migrations/002_add_user_tokens.sql`

---

### 2. Token Storage Module

**File:** `src/lib/auth/token-storage.ts`

**Functions:**

```typescript
// Save or update tokens (upsert)
await saveUserTokens(userId, tokens, userInfo);

// Get tokens by user ID  
const tokens = await getUserTokens(userId);

// Get tokens by account ID (for webhook processing)
const tokens = await getUserTokensByAccountId(accountId);

// Delete tokens
await deleteUserTokens(userId);

// Check if token is expired
const expired = isTokenExpired(expiresAt, thresholdMinutes);
```

---

### 3. OAuth Flow Integration

**Updated:** `src/app/api/auth/callback/route.ts`

When user completes OAuth login:
1. Exchange code for tokens (existing)
2. Get user info (existing)
3. **NEW:** Save tokens to database with `saveUserTokens()`
4. Create session cookie (existing)

```typescript
// Save tokens to database for server-side access
await saveUserTokens(
  userId,
  tokens,
  {
    accountId: userInfo.account_id,
    email: userInfo.email,
    name: userInfo.name,
  }
);
```

---

### 4. FrameioClient Enhancement

**Updated:** `src/lib/frameio-client.ts`

**New Method:** `FrameioClient.fromAccountId(accountId)`

For server-side operations (webhooks), create client using database tokens:

```typescript
// In webhook handler
const client = await FrameioClient.fromAccountId(accountId);
if (!client) {
  return NextResponse.json({ error: 'No auth found' }, { status: 401 });
}

// Use client normally
const file = await client.getFile(accountId, fileId);
```

**Features:**
- Automatically retrieves tokens from database
- Checks token expiration
- Auto-refreshes expired tokens
- Saves refreshed tokens back to database
- Returns null if no tokens found

---

## Usage Pattern

### Client-Side (Browser)
```typescript
// Uses session cookies
const client = await FrameioClient.fromSession();
```

### Server-Side (Webhooks)
```typescript
// Uses database tokens via account ID
const client = await FrameioClient.fromAccountId(accountId);
```

---

## Webhook Integration Example

```typescript
export async function POST(request: NextRequest) {
  const payload = await request.json();
  const accountId = payload.account_id;
  
  // Get client using database tokens
  const client = await FrameioClient.fromAccountId(accountId);
  if (!client) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }
  
  // Now you can use Frame.io API
  const file = await client.getFile(accountId, payload.resource.id);
  const versionStack = await client.getVersionStack(accountId, file.parent_id);
  // ... process video, transfer comments, etc.
}
```

---

## Security Considerations

### Token Storage
- ✅ Tokens stored in database (encrypted at rest by Neon)
- ✅ Not exposed to client-side
- ✅ Access restricted to server-side functions
- ⚠️ For production: Consider encrypting tokens before storing

### Token Refresh
- ✅ Automatic token refresh when expired
- ✅ Refreshed tokens saved back to database
- ✅ 5-minute expiration threshold (refresh before actual expiry)

### Token Cleanup
- 🔄 TODO: Implement token cleanup on logout
- 🔄 TODO: Implement token expiration cleanup job

---

## Migration Instructions

### 1. Run Database Migration

Run the SQL migration in your Neon database:

```bash
# Copy contents of src/lib/db/migrations/002_add_user_tokens.sql
# Paste and execute in Neon SQL Editor
```

### 2. Redeploy Application

```bash
git push origin main
# Vercel will automatically deploy
```

### 3. Users Must Re-authenticate

After deployment, existing users must:
1. Sign out
2. Sign in again (this will save their tokens to the database)

---

## Testing the Implementation

### Test with Webhook

1. **Trigger a webhook** from Frame.io
2. **Check logs** to see account_id from webhook:
   ```
   Account ID: f6365640-575c-42e5-8a7f-cd9e2d6b9273
   ```
3. **Use account ID** to get file:
   ```typescript
   const client = await FrameioClient.fromAccountId(accountId);
   const file = await client.getFile(accountId, fileId);
   console.log('File:', file.name);
   ```

### Verify Token Storage

Check database after signing in:
```sql
SELECT user_id, account_id, email, expires_at, created_at 
FROM user_tokens;
```

---

## Files Modified

1. ✅ `src/lib/db/schema.ts` - Added `userTokens` table
2. ✅ `src/lib/db/migrations/002_add_user_tokens.sql` - Migration SQL
3. ✅ `src/lib/auth/token-storage.ts` - Token management functions
4. ✅ `src/app/api/auth/callback/route.ts` - Save tokens on login
5. ✅ `src/lib/frameio-client.ts` - Added `fromAccountId()` method

---

## Next Steps

1. ✅ **Test with real webhook** - Verify tokens are retrieved correctly
2. 🔄 **Implement logout cleanup** - Delete tokens on sign out
3. 🔄 **Add token refresh in webhook handler** - Handle edge cases
4. 🔄 **Video processing** - Use `fromAccountId()` in video pipeline

---

**Status**: ✅ Ready for Testing  
**Last Updated**: September 29, 2025
