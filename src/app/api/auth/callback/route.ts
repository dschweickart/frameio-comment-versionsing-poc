import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCodeForTokens, getUserInfo, getUserAccounts, handleAuthError } from '@/lib/auth/oauth';
import { setSession } from '@/lib/auth/crypto';
import { saveUserTokens } from '@/lib/auth/token-storage';

export async function GET(request: NextRequest) {
  // Get base URL from request headers (available for both try and catch)
  const host = request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  const baseUrl = `${protocol}://${host}`;

  try {
    console.log('🔄 OAuth callback received');
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    console.log('Callback params:', { hasCode: !!code, hasState: !!state, hasError: !!error });

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

    // Get user information from /me endpoint
    const userInfo = await getUserInfo(tokens.access_token);
    console.log('📋 User info from /me:', JSON.stringify(userInfo, null, 2));

    // Get accounts that user has access to
    const accounts = await getUserAccounts(tokens.access_token);
    console.log('📋 Accounts from /accounts:', JSON.stringify(accounts, null, 2));

    // Extract user details - data is nested under 'data' key
    const userData = (userInfo as { data?: Record<string, unknown> }).data || userInfo;
    const userId = String(userData.id || '');
    const userEmail = String(userData.email || '');
    const userName = String(userData.name || '');

    // Get first account ID (simplification: store single active token)
    // TODO: Support multiple accounts in future
    const accountData = accounts[0] as Record<string, unknown>;
    const accountId = String(accountData?.id || '');

    console.log('💾 Extracted data:', { userId, accountId, userEmail, userName, accountCount: accounts.length });

    // Save tokens to database for server-side access
    try {
      await saveUserTokens(
        userId,
        tokens,
        {
          accountId,
          email: userEmail,
          name: userName,
        }
      );
      console.log('✅ Tokens saved to database successfully');
    } catch (dbError) {
      console.error('❌ Failed to save tokens to database:', dbError);
      console.error('Database error details:', dbError instanceof Error ? dbError.message : 'Unknown error');
      // Continue anyway - session cookie will still work for this session
    }

    // Create session
    const sessionData = {
      user: {
        id: userId,
        name: userName,
        email: userEmail,
        avatar_url: userInfo.avatar ? String(userInfo.avatar) : undefined
      },
      tokens
    };

    await setSession(sessionData);

    console.log('✅ Session created successfully, redirecting to:', `${baseUrl}/?auth=success`);
    
    // Redirect to success page
    return NextResponse.redirect(`${baseUrl}/?auth=success`);
  } catch (error) {
    console.error('❌ Callback error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    const { error: errorMessage, redirect } = handleAuthError(error);
    
    if (redirect) {
      return NextResponse.redirect(redirect);
    }

    return NextResponse.redirect(
      `${baseUrl}/?error=${encodeURIComponent(errorMessage || 'Authentication failed')}`
    );
  }
}
