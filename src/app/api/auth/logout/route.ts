import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/auth/crypto';

export async function POST() {
  try {
    // Clear the session cookie
    await clearSession();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Failed to logout' },
      { status: 500 }
    );
  }
}
