import { FrameioClient, FrameioFile, FrameioVersionStack } from '@/lib/frameio-client';

/**
 * Validation result for version stack checking
 */
export interface VersionStackValidation {
  isValid: boolean;
  versionStack?: FrameioVersionStack;
  versions?: FrameioFile[];
  error?: string;
  file?: FrameioFile;
}

/**
 * Validates that a file is part of a version stack and returns available versions
 * 
 * Workflow:
 * 1. Get file details using file ID
 * 2. Check if file has a parent
 * 3. Check if parent is a version_stack type
 * 4. Get version stack details
 * 5. List all children (versions) in the stack
 * 
 * @param client - Authenticated Frame.io client
 * @param accountId - Frame.io account ID
 * @param fileId - File ID to validate
 * @returns Validation result with versions if valid
 */
export async function validateVersionStack(
  client: FrameioClient,
  accountId: string,
  fileId: string
): Promise<VersionStackValidation> {
  try {
    // Step 1: Get file details
    const file = await client.getFile(accountId, fileId);

    if (!file) {
      return {
        isValid: false,
        error: 'File not found'
      };
    }

    // Step 2: Check if file has a parent
    if (!file.parent_id) {
      return {
        isValid: false,
        file,
        error: 'File is not part of a version stack (no parent)'
      };
    }

    // Step 3: Get parent to check if it's a version stack
    // The parent_id might be the version stack itself if the file is directly in the stack
    let versionStackId: string;
    
    // First, try to get the parent as a version stack
    try {
      const versionStack = await client.getVersionStack(accountId, file.parent_id);
      
      if (versionStack.type === 'version_stack') {
        versionStackId = versionStack.id;
        
        // Step 4: Get all children (versions) in the stack
        const versions = await client.listVersionStackChildren(accountId, versionStackId);
        
        return {
          isValid: true,
          versionStack,
          versions,
          file
        };
      }
    } catch (parentError) {
      // Parent might not be a version stack, try getting it as a file
      const parentFile = await client.getFile(accountId, file.parent_id);
      
      if (parentFile.type === 'version_stack') {
        versionStackId = parentFile.id;
        
        // Step 4: Get all children (versions) in the stack
        const versions = await client.listVersionStackChildren(accountId, versionStackId);
        
        return {
          isValid: true,
          versionStack: parentFile as unknown as FrameioVersionStack,
          versions,
          file
        };
      }
    }

    return {
      isValid: false,
      file,
      error: 'File parent is not a version stack'
    };
    
  } catch (error) {
    console.error('Version stack validation error:', error);
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown validation error'
    };
  }
}

/**
 * Validates that both source and target files are in the same version stack
 * 
 * @param client - Authenticated Frame.io client
 * @param accountId - Frame.io account ID
 * @param sourceFileId - Source file ID (with comments)
 * @param targetFileId - Target file ID (to receive comments)
 * @returns Validation result for both files
 */
export async function validateBothFilesInVersionStack(
  client: FrameioClient,
  accountId: string,
  sourceFileId: string,
  targetFileId: string
): Promise<{
  isValid: boolean;
  sourceValidation: VersionStackValidation;
  targetValidation: VersionStackValidation;
  error?: string;
}> {
  const sourceValidation = await validateVersionStack(client, accountId, sourceFileId);
  const targetValidation = await validateVersionStack(client, accountId, targetFileId);

  // Both must be valid
  if (!sourceValidation.isValid || !targetValidation.isValid) {
    return {
      isValid: false,
      sourceValidation,
      targetValidation,
      error: 'One or both files are not in a version stack'
    };
  }

  // Both must be in the same version stack
  if (sourceValidation.versionStack?.id !== targetValidation.versionStack?.id) {
    return {
      isValid: false,
      sourceValidation,
      targetValidation,
      error: 'Files are not in the same version stack'
    };
  }

  return {
    isValid: true,
    sourceValidation,
    targetValidation
  };
}

/**
 * Helper to extract video proxy URL from file
 * 
 * @param file - Frame.io file object
 * @returns Video proxy URL or null if not available
 */
export function getVideoProxyUrl(file: FrameioFile): string | null {
  return file.media_links?.video_h264_720 || null;
}

/**
 * Helper to format version list for display/selection
 * 
 * @param versions - List of version files
 * @returns Formatted version list with essential info
 */
export function formatVersionsForSelection(versions: FrameioFile[]): Array<{
  id: string;
  name: string;
  filesize?: number;
  duration?: number;
  hasVideoProxy: boolean;
}> {
  return versions.map(version => ({
    id: version.id,
    name: version.name,
    filesize: version.filesize,
    duration: version.duration,
    hasVideoProxy: !!version.media_links?.video_h264_720
  }));
}
