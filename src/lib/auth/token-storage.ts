import { db } from '@/lib/db';
import { userTokens, type UserToken, type NewUserToken } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Save or update user OAuth tokens in the database
 * 
 * @param userId - Frame.io user ID
 * @param tokens - OAuth token data
 * @param userInfo - Optional user information
 */
export async function saveUserTokens(
  userId: string,
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    obtained_at: number;
  },
  userInfo?: {
    accountId?: string;
    email?: string;
    name?: string;
  }
): Promise<UserToken> {
  const expiresAt = new Date(tokens.obtained_at + (tokens.expires_in * 1000));

  const tokenData: NewUserToken = {
    userId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    accountId: userInfo?.accountId,
    email: userInfo?.email,
    name: userInfo?.name,
  };

  // Upsert: insert or update if user_id already exists
  const result = await db
    .insert(userTokens)
    .values(tokenData)
    .onConflictDoUpdate({
      target: userTokens.userId,
      set: {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: tokenData.expiresAt,
        accountId: tokenData.accountId,
        email: tokenData.email,
        name: tokenData.name,
        updatedAt: new Date(),
      },
    })
    .returning();

  return result[0];
}

/**
 * Get user tokens from database by user ID
 * 
 * @param userId - Frame.io user ID
 * @returns User tokens or null if not found
 */
export async function getUserTokens(userId: string): Promise<UserToken | null> {
  const result = await db
    .select()
    .from(userTokens)
    .where(eq(userTokens.userId, userId))
    .limit(1);

  return result[0] || null;
}

/**
 * Get user tokens from database by account ID
 * Returns the first user found for the account (for POC - single user per account)
 * 
 * @param accountId - Frame.io account ID
 * @returns User tokens or null if not found
 */
export async function getUserTokensByAccountId(accountId: string): Promise<UserToken | null> {
  console.log(`🔍 Searching for tokens with account_id: ${accountId}`);
  
  const result = await db
    .select()
    .from(userTokens)
    .where(eq(userTokens.accountId, accountId))
    .limit(1);

  console.log(`📊 Query result:`, result.length > 0 ? 'Found token' : 'No token found');
  
  if (result.length > 0) {
    console.log(`✅ Token found for account: ${accountId}, user: ${result[0].userId}`);
  } else {
    console.log(`❌ No token found for account: ${accountId}`);
    // Log all account IDs to help debug
    const allTokens = await db.select({ accountId: userTokens.accountId, userId: userTokens.userId }).from(userTokens);
    console.log(`📋 Available account_ids in database:`, allTokens);
  }

  return result[0] || null;
}

/**
 * Delete user tokens from database
 * 
 * @param userId - Frame.io user ID
 */
export async function deleteUserTokens(userId: string): Promise<void> {
  await db
    .delete(userTokens)
    .where(eq(userTokens.userId, userId));
}

/**
 * Check if tokens are expired or will expire soon
 * 
 * @param expiresAt - Token expiration timestamp
 * @param thresholdMinutes - Minutes before expiry to consider expired (default: 5)
 * @returns True if tokens are expired or will expire soon
 */
export function isTokenExpired(expiresAt: Date, thresholdMinutes: number = 5): boolean {
  const now = new Date();
  const threshold = new Date(now.getTime() + (thresholdMinutes * 60 * 1000));
  return expiresAt <= threshold;
}
