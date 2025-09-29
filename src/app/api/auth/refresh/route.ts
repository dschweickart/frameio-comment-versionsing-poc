import { NextResponse } from 'next/server';
import { getSession, setSession } from '@/lib/auth/crypto';
import { refreshAccessToken, handleAuthError } from '@/lib/auth/oauth';

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
