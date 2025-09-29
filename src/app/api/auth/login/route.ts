import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { 
  generateCodeVerifier, 
  generateCodeChallenge, 
  generateState 
} from '@/lib/auth/crypto';
import { buildAuthUrl } from '@/lib/auth/oauth';

export async function GET(request: NextRequest) {
  try {
    // Generate PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Build redirect URI dynamically from request
    const host = request.headers.get('host');
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const baseUrl = `${protocol}://${host}`;
    const redirectUri = `${baseUrl}/api/auth/callback`;

    // Store PKCE parameters in secure cookies for callback verification
    const cookieStore = await cookies();
    cookieStore.set('oauth_code_verifier', codeVerifier, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/'
    });
    cookieStore.set('oauth_state', state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/'
    });

    // Build authorization URL
    const authUrl = buildAuthUrl(codeChallenge, state, redirectUri);

    // Redirect to Adobe OAuth
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate authentication' },
      { status: 500 }
    );
  }
}
