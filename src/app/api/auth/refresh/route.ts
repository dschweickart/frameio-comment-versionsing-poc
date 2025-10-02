import { NextResponse } from 'next/server';
import { getSession, setSession } from '@/lib/auth/crypto';
import { refreshAccessToken, handleAuthError } from '@/lib/auth/oauth';
import { saveUserTokens } from '@/lib/auth/token-storage';

export async function POST() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Refresh the access token
    const newTokens = await refreshAccessToken(session.tokens.refresh_token);

    // Update session with new tokens
    const updatedSession = {
      ...session,
      tokens: newTokens
    };

    await setSession(updatedSession);

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

    return NextResponse.json({
      access_token: newTokens.access_token,
      expires_in: newTokens.expires_in
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    const { error: errorMessage, redirect } = handleAuthError(error);

    if (redirect) {
      return NextResponse.json(
        { error: 'Authentication required', redirect },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: errorMessage || 'Failed to refresh token' },
      { status: 500 }
    );
  }
}
