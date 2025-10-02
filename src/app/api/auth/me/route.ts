import { NextResponse } from 'next/server';
import { getSession, setSession } from '@/lib/auth/crypto';
import { refreshAccessToken } from '@/lib/auth/oauth';
import { saveUserTokens } from '@/lib/auth/token-storage';

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Check if token needs refresh (refresh 5 minutes before expiry)
    const expiresAt = session.tokens.obtained_at + (session.tokens.expires_in * 1000);
    const shouldRefresh = Date.now() >= (expiresAt - 300000); // 5 minutes

    if (shouldRefresh) {
      try {
        console.log('Refreshing access token...');
        const newTokens = await refreshAccessToken(session.tokens.refresh_token);
        
        // Update session with new tokens
        session.tokens = newTokens;
        await setSession(session);
        
        // Also update database tokens for webhook/serverside access
        try {
          await saveUserTokens(
            session.user.id,
            newTokens,
            {
              email: session.user.email,
              name: session.user.name,
            }
          );
          console.log('Token refreshed and saved to both session and database');
        } catch (dbError) {
          console.error('Failed to update database tokens (session still updated):', dbError);
          // Continue - session refresh still succeeded
        }
      } catch (error) {
        console.error('Token refresh failed:', error);
        return NextResponse.json(
          { error: 'Token expired' },
          { status: 401 }
        );
      }
    }

    return NextResponse.json({
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      avatar_url: session.user.avatar_url
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { error: 'Failed to get user info' },
      { status: 500 }
    );
  }
}
