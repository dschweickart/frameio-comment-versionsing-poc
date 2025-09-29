# Phase 2 Implementation Log: Video Processing & Comment Transfer

## Session: September 29, 2025

### ✅ Completed Tasks

---

### Task #1: Update Frame.io Client with V4 Version Stack Methods

**Status**: ✅ Complete  
**Duration**: ~15 minutes  
**Files Modified**:
- `src/lib/frameio-client.ts`

**Implementation Details**:

Added full support for Frame.io V4 Version Stack API (stable, not experimental):

#### New TypeScript Interfaces:
```typescript
export interface FrameioFile {
  id: string;
  name: string;
  type: 'file' | 'folder' | 'version_stack';
  parent_id?: string;
  project_id?: string;
  media_links?: {
    video_h264_720?: string;
    [key: string]: unknown;
  };
  filesize?: number;
  fps?: number;
  duration?: number;
  [key: string]: unknown;
}

export interface FrameioVersionStack {
  id: string;
  name: string;
  type: 'version_stack';
  parent_id: string;
  project_id: string;
  version_count?: number;
  latest_version_id?: string;
  [key: string]: unknown;
}
```

#### New API Methods:
1. **`getFile(accountId, fileId)`** - Get file details by ID
2. **`getVersionStack(accountId, versionStackId)`** - Get version stack details
3. **`listVersionStackChildren(accountId, versionStackId)`** - List all versions in stack
4. **`createVersionStack(accountId, folderId, data)`** - Create new version stack

**API Reference**: https://developer.adobe.com/frameio/api/current/#tag/Version-Stacks

---

### Task #2: Implement Version Stack Validation Logic

**Status**: ✅ Complete  
**Duration**: ~20 minutes  
**Files Created**:
- `src/lib/video/version-stack-validator.ts`
- `src/app/api/version-stack/validate/route.ts`

**Implementation Details**:

Created comprehensive validation system for ensuring files are in version stacks before processing.

#### Core Validation Function:
```typescript
validateVersionStack(client, accountId, fileId): Promise<VersionStackValidation>
```

**Workflow**:
1. Get file details using `getFile()`
2. Check if file has a parent
3. Verify parent is a version_stack type
4. Get version stack details
5. List all children (versions) in the stack
6. Return validation result with all versions

#### Additional Utilities:
- **`validateBothFilesInVersionStack()`** - Ensures source and target are in same version stack
- **`getVideoProxyUrl()`** - Extract video proxy URL from file
- **`formatVersionsForSelection()`** - Format versions for UI display/selection

#### API Endpoint:
**POST** `/api/version-stack/validate`

Request:
```json
{
  "accountId": "account_123",
  "fileId": "file_456",
  "targetFileId": "file_789" // optional
}
```

Response (Success):
```json
{
  "success": true,
  "versionStack": { ... },
  "versions": [
    {
      "id": "file_456",
      "name": "video_v1.mp4",
      "filesize": 45000000,
      "duration": 120,
      "hasVideoProxy": true
    },
    {
      "id": "file_789",
      "name": "video_v2.mp4",
      "filesize": 48000000,
      "duration": 125,
      "hasVideoProxy": true
    }
  ],
  "file": { ... }
}
```

Response (Error):
```json
{
  "success": false,
  "error": "File is not part of a version stack (no parent)",
  "file": { ... }
}
```

---

## Architecture Decisions

### 1. Version Stack Requirement
✅ **Decision**: Enforce version stack requirement for all comment transfers
- **Rationale**: Ensures files are related versions, improves UX, validates workflow
- **Impact**: Users must organize files in version stacks before processing

### 2. Storage Strategy
✅ **Decision**: Use `/tmp` directory for video downloads
- **Limit**: 512MB writable storage in Vercel serverless functions
- **Max File Size**: 500MB (fits within limit)
- **Cleanup**: Automatic after function execution
- **Processing**: Sequential (download → process → delete → repeat)

### 3. Frame Extraction Rate
✅ **Decision**: Start conservatively with **0.5fps** (1 frame every 2 seconds)
- **10-minute video**: ~300 frames
- **5-minute video**: ~150 frames
- **Can be increased**: Based on performance testing

### 4. Embedding Generation
✅ **Decision**: Generate embeddings immediately after frame extraction
- **Rationale**: Minimizes temp storage needs, simplifies pipeline
- **Batch Size**: Process in batches of 50 frames
- **Storage**: Direct to PostgreSQL frames table

### 5. Monitoring
✅ **Decision**: Simple start/complete status tracking
- **No real-time progress**: Reduces complexity for POC
- **Job Status**: Stored in `processing_jobs` table
- **Error Logging**: Console and database

---

## Next Steps

### Remaining Tasks (Priority Order):

1. **Implement Video Download to /tmp Directory**
   - Stream Frame.io proxy videos (media_links.video_h264_720)
   - Handle up to 500MB files
   - Automatic cleanup

2. **Implement FFmpeg Frame Extraction at Comment Timestamps**
   - Extract frames only where comments exist
   - Use: `ffmpeg -ss HH:MM:SS.mmm -i video.mp4 -frames:v 1 output.jpg`

3. **Implement FFmpeg Frame Extraction at Regular Intervals**
   - Extract at 0.5fps (1 frame every 2 seconds)
   - Use: `ffmpeg -i video.mp4 -vf fps=0.5 output-%04d.jpg`

4. **Implement Multi-Modal Embedding Generation**
   - Vercel AI SDK + OpenAI embeddings
   - 1536-dimensional vectors (text-embedding-3-small)
   - Batch processing (50 frames at a time)

5. **Create Video Processing Orchestration Function**
   - Main pipeline coordinator
   - maxDuration: 900s (15 min)
   - memory: 3072MB (3GB)

6. **Implement Vector Similarity Matching**
   - PostgreSQL pgvector with cosine distance
   - Configurable threshold (default: 0.8)
   - Single best match per source frame

7. **Implement Automated Comment Transfer System**
   - Map timestamps via similarity matches
   - Transfer with author attribution
   - Handle missing matches gracefully

8. **Update Vercel Configuration**
   - Function memory and timeout settings
   - Environment variables

---

## Technical Notes

### Frame.io V4 API Changes
- ✅ Version Stacks are now in **stable** V4 API (not experimental)
- ✅ Assets renamed to specific entities: Files, Folders, Version Stacks
- ✅ All endpoints require `account_id` parameter

### Performance Considerations
- **Video Size**: Max 500MB (fits in /tmp limit)
- **Processing Time**: Target <2 min for 10-min video
- **Memory**: 3GB allocated for processing function
- **Frame Count**: ~300 frames @ 0.5fps for 10-min video

### Security
- ✅ Session-based authentication required
- ✅ Token refresh automatic
- ✅ HTTPS enforced
- ✅ Webhook signature verification ready

---

**Last Updated**: September 29, 2025  
**Next Session Focus**: Video download and FFmpeg integration
