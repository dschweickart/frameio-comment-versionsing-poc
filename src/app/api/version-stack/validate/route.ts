import { NextRequest, NextResponse } from 'next/server';
import { FrameioClient } from '@/lib/frameio-client';
import { validateVersionStack, validateBothFilesInVersionStack, formatVersionsForSelection } from '@/lib/video/version-stack-validator';

/**
 * API Route: Validate Version Stack
 * 
 * POST /api/version-stack/validate
 * 
 * Validates that a file is part of a version stack and returns available versions
 * 
 * Request body:
 * {
 *   "accountId": "account_id",
 *   "fileId": "file_id",
 *   "targetFileId": "target_file_id" (optional - for validating both files)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accountId, fileId, targetFileId } = body;

    if (!accountId || !fileId) {
      return NextResponse.json(
        { error: 'Missing required fields: accountId, fileId' },
        { status: 400 }
      );
    }

    // Get authenticated Frame.io client from session
    const client = await FrameioClient.fromSession();
    if (!client) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // If targetFileId is provided, validate both files
    if (targetFileId) {
      const validation = await validateBothFilesInVersionStack(
        client,
        accountId,
        fileId,
        targetFileId
      );

      if (!validation.isValid) {
        return NextResponse.json({
          success: false,
          error: validation.error,
          source: validation.sourceValidation,
          target: validation.targetValidation
        }, { status: 400 });
      }

      // Format versions for selection
      const formattedVersions = validation.sourceValidation.versions
        ? formatVersionsForSelection(validation.sourceValidation.versions)
        : [];

      return NextResponse.json({
        success: true,
        versionStack: validation.sourceValidation.versionStack,
        versions: formattedVersions,
        source: {
          file: validation.sourceValidation.file,
          isValid: true
        },
        target: {
          file: validation.targetValidation.file,
          isValid: true
        }
      });
    }

    // Single file validation
    const validation = await validateVersionStack(client, accountId, fileId);

    if (!validation.isValid) {
      return NextResponse.json({
        success: false,
        error: validation.error,
        file: validation.file
      }, { status: 400 });
    }

    // Format versions for selection
    const formattedVersions = validation.versions
      ? formatVersionsForSelection(validation.versions)
      : [];

    return NextResponse.json({
      success: true,
      versionStack: validation.versionStack,
      versions: formattedVersions,
      file: validation.file
    });

  } catch (error) {
    console.error('Version stack validation error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to validate version stack',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
