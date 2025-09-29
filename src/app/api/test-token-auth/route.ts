import { NextRequest, NextResponse } from 'next/server';
import { FrameioClient } from '@/lib/frameio-client';
import { validateVersionStack, formatVersionsForSelection } from '@/lib/video/version-stack-validator';

/**
 * Test endpoint for database token authentication
 * 
 * POST /api/test-token-auth
 * 
 * Body:
 * {
 *   "accountId": "f6365640-575c-42e5-8a7f-cd9e2d6b9273",
 *   "fileId": "6826a939-26ee-426e-9227-70d517090ef6"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accountId, fileId } = body;

    if (!accountId || !fileId) {
      return NextResponse.json(
        { error: 'Missing accountId or fileId' },
        { status: 400 }
      );
    }

    console.log('🧪 Testing token auth with:');
    console.log('  Account ID:', accountId);
    console.log('  File ID:', fileId);

    // Try to create client from database tokens
    console.log('📡 Creating Frame.io client from database tokens...');
    const client = await FrameioClient.fromAccountId(accountId);

    if (!client) {
      return NextResponse.json(
        { 
          error: 'No authentication tokens found for account',
          message: 'Please sign out and sign back in to save tokens to database',
          accountId 
        },
        { status: 401 }
      );
    }

    console.log('✅ Client created successfully!');

    // Test 1: Get file details
    console.log('\n📄 Test 1: Getting file details...');
    const file = await client.getFile(accountId, fileId);
    console.log('✅ File retrieved:', file.name);

    // Test 2: Validate version stack
    console.log('\n🔍 Test 2: Validating version stack...');
    const validation = await validateVersionStack(client, accountId, fileId);

    if (!validation.isValid) {
      return NextResponse.json({
        success: false,
        error: validation.error,
        file,
        accountId
      }, { status: 400 });
    }

    console.log('✅ Version stack validated!');

    // Test 3: Get all versions (siblings)
    const formattedVersions = validation.versions
      ? formatVersionsForSelection(validation.versions)
      : [];

    console.log('\n🎬 Found', formattedVersions.length, 'versions in stack');
    formattedVersions.forEach((version, index) => {
      const isCurrent = version.id === fileId;
      console.log(`${isCurrent ? '👉' : '  '} Version ${index + 1}:`, version.name);
    });

    return NextResponse.json({
      success: true,
      message: 'Token authentication working! ✅',
      results: {
        client: '✅ Created from database tokens',
        file: {
          id: file.id,
          name: file.name,
          type: file.type,
          parent_id: file.parent_id,
        },
        versionStack: {
          id: validation.versionStack?.id,
          name: validation.versionStack?.name,
          type: validation.versionStack?.type,
        },
        versions: formattedVersions,
        currentFileId: fileId,
      },
      accountId,
    });

  } catch (error) {
    console.error('❌ Test error:', error);
    return NextResponse.json(
      { 
        error: 'Test failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'POST to this endpoint with accountId and fileId',
    example: {
      accountId: 'f6365640-575c-42e5-8a7f-cd9e2d6b9273',
      fileId: '6826a939-26ee-426e-9227-70d517090ef6',
    }
  });
}
