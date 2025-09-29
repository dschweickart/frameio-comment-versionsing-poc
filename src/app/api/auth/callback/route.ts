import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCodeForTokens, getUserInfo, handleAuthError } from '@/lib/auth/oauth';
import { setSession } from '@/lib/auth/crypto';

export async function GET(request: NextRequest) {
  // Get base URL from request headers (available for both try and catch)
  const host = request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  const baseUrl = `${protocol}://${host}`;

  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Handle OAuth errors
    if (error) {
      const errorDescription = searchParams.get('error_description');
      console.error('OAuth error:', error, errorDescription);
      return NextResponse.redirect(`${baseUrl}/?error=${encodeURIComponent(errorDescription || error)}`);
    }

    if (!code || !state) {
      return NextResponse.redirect(`${baseUrl}/?error=missing_parameters`);
    }

    // Verify state and get code verifier from cookies
    const cookieStore = await cookies();
    const storedState = cookieStore.get('oauth_state')?.value;
    const codeVerifier = cookieStore.get('oauth_code_verifier')?.value;

    if (!storedState || !codeVerifier) {
      return NextResponse.redirect(`${baseUrl}/?error=invalid_session`);
    }

    if (storedState !== state) {
      return NextResponse.redirect(`${baseUrl}/?error=invalid_state`);
    }

    // Clear OAuth cookies
    cookieStore.delete('oauth_state');
    cookieStore.delete('oauth_code_verifier');

    // Exchange code for tokens
    const redirectUri = `${baseUrl}/api/auth/callback`;
    
    const tokens = await exchangeCodeForTokens(code, codeVerifier, redirectUri);

    // Get user information
    const userInfo = await getUserInfo(tokens.access_token);

    // Create session
    const sessionData = {
      user: {
        id: String(userInfo.user_id || userInfo.id || ''),
        name: String(userInfo.name || ''),
        email: String(userInfo.email || ''),
        avatar_url: userInfo.avatar ? String(userInfo.avatar) : undefined
      },
      tokens
    };

    await setSession(sessionData);

    // Redirect to success page
    return NextResponse.redirect(`${baseUrl}/?auth=success`);
  } catch (error) {
    console.error('Callback error:', error);
    const { error: errorMessage, redirect } = handleAuthError(error);
    
    if (redirect) {
      return NextResponse.redirect(redirect);
    }

    return NextResponse.redirect(
      `${baseUrl}/?error=${encodeURIComponent(errorMessage || 'Authentication failed')}`
    );
  }
}
