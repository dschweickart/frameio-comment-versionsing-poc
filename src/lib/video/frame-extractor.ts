import { execSync } from 'child_process';
import path from 'path';
import { existsSync } from 'fs';
import ffmpegPath from 'ffmpeg-static';
// @ts-expect-error - ffprobe-static doesn't have TypeScript types
import ffprobePath from 'ffprobe-static';

// Helper to fix /ROOT/ placeholder paths
function resolveBinaryPath(binaryPath: string | null | undefined): string | null {
  if (!binaryPath) return null;
  
  // If path contains /ROOT/, replace it with actual working directory
  if (binaryPath.includes('/ROOT/')) {
    const fixed = binaryPath.replace('/ROOT/', `${process.cwd()}/`);
    console.log(`🔧 Fixed path: ${binaryPath} -> ${fixed}`);
    
    // Verify the file exists
    if (existsSync(fixed)) {
      console.log(`✅ Binary exists at: ${fixed}`);
      return fixed;
    } else {
      console.warn(`⚠️ Binary not found at: ${fixed}`);
      return null;
    }
  }
  
  return binaryPath;
}

// Get static binary paths (fallback to system binaries if resolution fails)
const resolvedFFmpeg = resolveBinaryPath(ffmpegPath);
const resolvedFFprobe = resolveBinaryPath(ffprobePath?.path || ffprobePath);

const FFMPEG_BIN = resolvedFFmpeg || 'ffmpeg';
const FFPROBE_BIN = resolvedFFprobe || 'ffprobe';

// Debug: Log the resolved paths
console.log('🔍 FFmpeg binary paths:', {
  ffmpeg: FFMPEG_BIN,
  ffprobe: FFPROBE_BIN,
  cwd: process.cwd()
});

export interface ExtractedFrame {
  frameNumber?: number;  // For source frames (Frame.io uses frame numbers)
  timestamp?: number;    // For target frames (in seconds, for time-based matching)
  buffer: Buffer;
}

// Configuration constants
export const KEYFRAME_INTERVAL_SECONDS = 1.0;  // Extract target keyframes every 1 second
export const REFINEMENT_WINDOW_SECONDS = 0.5;  // ±0.5s around coarse matches

/**
 * Extract frames at specific frame numbers from a video URL (FRAME-BASED for source comments)
 * For large frame counts (>100), automatically chunks into multiple FFmpeg calls to avoid command-line buffer limits.
 * 
 * NOTE FOR PRODUCTION: For very large videos or high-volume workloads, consider:
 * - Job queuing (e.g., BullMQ, AWS SQS)
 * - Distributed processing (e.g., multiple workers)
 * - Caching extracted keyframes for reuse
 */
export async function extractFramesAtPositions(
  videoUrl: string,
  frameNumbers: number[],
  fps: number
): Promise<ExtractedFrame[]> {
  if (frameNumbers.length === 0) {
    return [];
  }

  const CHUNK_SIZE = 100; // Max frames per FFmpeg call to avoid ENOBUFS (long URLs reduce available buffer)

  // If frame count is small, extract in one call
  if (frameNumbers.length <= CHUNK_SIZE) {
    console.log(`🎬 Extracting ${frameNumbers.length} frames at positions: ${frameNumbers.join(', ')}`);
    return await extractFramesBatch(videoUrl, frameNumbers, fps);
  }

  // For large frame counts, chunk into multiple calls
  const totalChunks = Math.ceil(frameNumbers.length / CHUNK_SIZE);
  console.log(`🎬 Extracting ${frameNumbers.length} frames in ${totalChunks} chunks of ${CHUNK_SIZE}...`);
  console.log(`⏱️  Estimated time: ${(totalChunks * 3).toFixed(0)}-${(totalChunks * 5).toFixed(0)} seconds (varies by video length)\n`);
  
  const allFrames: ExtractedFrame[] = [];
  const overallStartTime = Date.now();
  
  for (let i = 0; i < frameNumbers.length; i += CHUNK_SIZE) {
    const chunk = frameNumbers.slice(i, i + CHUNK_SIZE);
    const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
    
    const chunkStartTime = Date.now();
    console.log(`📦 [${chunkNumber}/${totalChunks}] Extracting frames ${chunk[0]} to ${chunk[chunk.length - 1]} (${chunk.length} frames)...`);
    
    const chunkFrames = await extractFramesBatch(videoUrl, chunk, fps);
    allFrames.push(...chunkFrames);
    
    const chunkDuration = Date.now() - chunkStartTime;
    const elapsed = (Date.now() - overallStartTime) / 1000;
    const estimatedTotal = (elapsed / chunkNumber) * totalChunks;
    const remaining = estimatedTotal - elapsed;
    
    console.log(`   ✅ Chunk ${chunkNumber} complete in ${(chunkDuration / 1000).toFixed(1)}s (Total: ${allFrames.length} frames | ${elapsed.toFixed(0)}s elapsed | ~${remaining.toFixed(0)}s remaining)\n`);
  }

  const totalDuration = (Date.now() - overallStartTime) / 1000;
  console.log(`✅ Extracted ${allFrames.length} frames in ${totalChunks} chunks (${totalDuration.toFixed(1)}s total)`);
  return allFrames;
}

/**
 * Internal helper: Extracts a single batch of frames in one FFmpeg call
 */
async function extractFramesBatch(
  videoUrl: string,
  frameNumbers: number[],
  fps: number
): Promise<ExtractedFrame[]> {
  // Build select filter: select='eq(n,24)+eq(n,48)+eq(n,120)'
  const selectFilter = frameNumbers.map(n => `eq(n\\,${n})`).join('+');

  try {
    // Extract all frames to stdout as JPEG stream
    const ffmpegCommand = `"${FFMPEG_BIN}" -i "${videoUrl}" -vf "select='${selectFilter}'" -vsync 0 -f image2pipe -c:v mjpeg -`;
    
    const jpegStream = execSync(ffmpegCommand, {
      encoding: 'buffer',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
    });

    // Reduced logging - parent function will log progress

    // Parse JPEG stream into individual frames
    const frames = parseJpegStream(jpegStream, frameNumbers);
    
    // Add timestamps for each frame (frame number / fps)
    frames.forEach(frame => {
      if (frame.frameNumber !== undefined) {
        frame.timestamp = frame.frameNumber / fps;
      }
    });

    return frames;
  } catch (error) {
    console.error('❌ FFmpeg frame extraction failed:', error);
    throw new Error(`Failed to extract frames: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Extract keyframes at regular intervals from a video URL
 * Used to create a matching pool for the target video
 */
export async function extractKeyframes(
  videoUrl: string,
  intervalFrames: number = 12 // Every 12 frames = 0.5s @ 24fps
): Promise<ExtractedFrame[]> {
  console.log(`🎬 Extracting keyframes every ${intervalFrames} frames...`);

  try {
    // Extract frames at regular intervals
    const selectFilter = `not(mod(n\\,${intervalFrames}))`;
    const ffmpegCommand = `"${FFMPEG_BIN}" -i "${videoUrl}" -vf "select='${selectFilter}'" -vsync 0 -f image2pipe -c:v mjpeg -`;
    
    console.log('📹 Running FFmpeg with interval filter...');
    const startTime = Date.now();
    
    const jpegStream = execSync(ffmpegCommand, {
      encoding: 'buffer',
      maxBuffer: 100 * 1024 * 1024, // 100MB buffer for potentially many frames
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const duration = Date.now() - startTime;
    console.log(`✅ FFmpeg completed in ${duration}ms, parsing JPEG stream...`);

    // For keyframes, we need to determine frame numbers from the stream
    // We'll extract them sequentially: 0, 12, 24, 36, etc.
    const frames = parseJpegStream(jpegStream);
    
    // Assign frame numbers based on interval
    frames.forEach((frame, index) => {
      frame.frameNumber = index * intervalFrames;
    });

    console.log(`✅ Extracted ${frames.length} keyframes`);
    return frames;
  } catch (error) {
    console.error('❌ FFmpeg keyframe extraction failed:', error);
    throw new Error(`Failed to extract keyframes: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Parse a JPEG stream buffer into individual frame buffers
 * JPEG markers: FF D8 (start) and FF D9 (end)
 */
function parseJpegStream(
  streamBuffer: Buffer,
  knownFrameNumbers?: number[]
): ExtractedFrame[] {
  const frames: ExtractedFrame[] = [];
  const JPEG_SOI = Buffer.from([0xFF, 0xD8]); // Start of Image
  const JPEG_EOI = Buffer.from([0xFF, 0xD9]); // End of Image

  let currentPos = 0;
  let frameIndex = 0;

  while (currentPos < streamBuffer.length) {
    // Find start of JPEG
    const startPos = streamBuffer.indexOf(JPEG_SOI, currentPos);
    if (startPos === -1) break;

    // Find end of JPEG (search after start position + 2)
    const endPos = streamBuffer.indexOf(JPEG_EOI, startPos + 2);
    if (endPos === -1) break;

    // Extract frame (include EOI marker)
    const frameBuffer = streamBuffer.subarray(startPos, endPos + 2);
    
    frames.push({
      frameNumber: knownFrameNumbers ? knownFrameNumbers[frameIndex] : frameIndex,
      buffer: frameBuffer,
    });

    frameIndex++;
    currentPos = endPos + 2;
  }

  return frames;
}

/**
 * Get video metadata using ffprobe
 * Returns fps, duration, and total frame count
 */
export async function getVideoMetadata(videoUrl: string): Promise<{
  fps: number;
  duration: number;
  frameCount: number;
  width: number;
  height: number;
}> {
  try {
    const ffprobeCommand = `"${FFPROBE_BIN}" -v quiet -print_format json -show_format -show_streams "${videoUrl}"`;
    
    const output = execSync(ffprobeCommand, { encoding: 'utf8' });
    const data = JSON.parse(output);
    
    const videoStream = data.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    if (!videoStream) {
      throw new Error('No video stream found');
    }

    // Parse frame rate (e.g., "24/1" → 24)
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    const fps = num / den;
    
    const duration = parseFloat(data.format.duration);
    const frameCount = Math.floor(duration * fps);

    return {
      fps,
      duration,
      frameCount,
      width: videoStream.width,
      height: videoStream.height,
    };
  } catch (error) {
    console.error('❌ ffprobe failed:', error);
    throw new Error(`Failed to get video metadata: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Extract I-frames (intra-coded frames) from video (ADAPTIVE KEYFRAMES for target video)
 * I-frames are naturally encoded keyframes placed by the video encoder.
 * They tend to be denser in fast-cut videos (trailers) and sparser in long-form content.
 * 
 * Benefits:
 * - Adaptive density (matches video's natural cut points)
 * - Fast extraction (no sequential decoding needed)
 * - Works well for both trailers and long-form content
 * 
 * Returns frames with timestamp property (in seconds).
 */
export async function extractIFrames(
  videoUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _fps: number  // Parameter kept for API consistency, not used in I-frame extraction
): Promise<ExtractedFrame[]> {
  console.log(`🎬 Extracting I-frames (natural encoding keyframes)...`);

  try {
    // Extract only I-frames (pict_type=I means intra-coded frame), downscaled for faster hashing
    const selectFilter = `eq(pict_type\\,I)`;
    const ffmpegCommand = `"${FFMPEG_BIN}" -i "${videoUrl}" -vf "scale=320:-1,select='${selectFilter}'" -vsync 0 -f image2pipe -c:v mjpeg -q:v 5 -`;
    
    console.log(`📹 Running FFmpeg I-frame extraction...`);
    const startTime = Date.now();
    
    const jpegStream = execSync(ffmpegCommand, {
      encoding: 'buffer',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer (downscaled frames are much smaller)
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const duration = Date.now() - startTime;
    console.log(`✅ FFmpeg completed in ${(duration / 1000).toFixed(1)}s, parsing JPEG stream...`);

    const frames = parseJpegStream(jpegStream);
    
    // For I-frames, we don't know exact frame numbers ahead of time
    // FFmpeg outputs them sequentially, so we estimate timestamps
    // based on uniform distribution (we'll refine this if needed)
    const metadata = await getVideoMetadata(videoUrl);
    const timePerFrame = metadata.duration / frames.length;
    
    frames.forEach((frame, index) => {
      frame.timestamp = index * timePerFrame;
    });

    console.log(`✅ Extracted ${frames.length} I-frames (avg 1 per ${(metadata.duration / frames.length).toFixed(1)}s)`);
    return frames;
  } catch (error) {
    console.error('❌ FFmpeg I-frame extraction failed:', error);
    throw new Error(`Failed to extract I-frames: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Extract frames in a specific time range using -ss seeking (for refinement phase)
 * Uses HTTP range requests for efficient remote video access.
 */
export async function extractFramesInTimeRange(
  videoUrl: string,
  startTime: number,
  endTime: number,
  fps: number
): Promise<ExtractedFrame[]> {
  try {
    // Seek to start time, then extract all frames in the range (downscaled for faster hashing)
    // Use yuvj420p pixel format for proper JPEG color space
    const ffmpegCommand = `"${FFMPEG_BIN}" -ss ${startTime} -i "${videoUrl}" -vf "scale=320:-1,select='gte(t,${startTime})*lte(t,${endTime})'" -vsync 0 -pix_fmt yuvj420p -f image2pipe -c:v mjpeg -q:v 5 -`;
    
    const jpegStream = execSync(ffmpegCommand, {
      encoding: 'buffer',
      maxBuffer: 5 * 1024 * 1024, // 5MB (smaller due to downscaling)
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const frames = parseJpegStream(jpegStream);
    
    // Assign timestamps based on position in range
    const timePerFrame = 1 / fps;
    frames.forEach((frame, index) => {
      frame.timestamp = startTime + (index * timePerFrame);
    });

    return frames;
  } catch (error) {
    console.error(`❌ Failed to extract frames in range ${startTime}s-${endTime}s:`, error);
    throw new Error(`Failed to extract time range: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Extract individual frames using -ss seeking (for sparse frame extraction)
 * Uses HTTP range requests for efficient remote video access.
 * Ideal for extracting comment frames (sparse, specific positions).
 */
export async function extractFramesWithSeeking(
  videoUrl: string,
  frameNumbers: number[],
  fps: number,
  concurrency: number = 4
): Promise<ExtractedFrame[]> {
  if (frameNumbers.length === 0) return [];

  console.log(`🎬 Extracting ${frameNumbers.length} frames using -ss seeking (${concurrency} parallel)...`);

  const allFrames: ExtractedFrame[] = [];
  
  // Process in batches for concurrency control
  for (let i = 0; i < frameNumbers.length; i += concurrency) {
    const batch = frameNumbers.slice(i, i + concurrency);
    const batchNumber = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(frameNumbers.length / concurrency);
    
    console.log(`📦 Batch ${batchNumber}/${totalBatches}: Extracting frames ${batch.join(', ')}...`);
    
    const batchPromises = batch.map(async (frameNumber) => {
      const timestamp = frameNumber / fps;
      
      try {
        // Seek to timestamp and extract 1 frame (downscaled for faster hashing)
        const ffmpegCommand = `"${FFMPEG_BIN}" -ss ${timestamp} -i "${videoUrl}" -vf "scale=320:-1" -frames:v 1 -f image2pipe -c:v mjpeg -q:v 5 -`;
        
        const jpegBuffer = execSync(ffmpegCommand, {
          encoding: 'buffer',
          maxBuffer: 512 * 1024, // 512KB per frame (smaller due to downscaling)
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        return {
          frameNumber,
          timestamp,
          buffer: jpegBuffer,
        };
      } catch (error) {
        console.error(`❌ Failed to extract frame ${frameNumber}:`, error);
        throw error;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    allFrames.push(...batchResults);
  }

  console.log(`✅ Extracted ${allFrames.length} frames using -ss seeking`);
  return allFrames;
}

/**
 * Extract refinement frames using regional -ss batching with parallelization
 * Groups nearby time ranges and extracts them in parallel for efficiency.
 */
export async function extractRefinementFrames(
  videoUrl: string,
  timestamps: number[],
  fps: number,
  windowSeconds: number = REFINEMENT_WINDOW_SECONDS,
  concurrency: number = 4
): Promise<ExtractedFrame[]> {
  if (timestamps.length === 0) return [];

  console.log(`🎬 Extracting refinement frames for ${timestamps.length} timestamps (±${windowSeconds}s windows)...`);

  // Step 1: Create time ranges for each timestamp
  const ranges = timestamps.map(ts => ({
    start: Math.max(0, ts - windowSeconds),
    end: ts + windowSeconds,
    centerTimestamp: ts,
  }));

  // Step 2: Group nearby ranges (within 3 seconds to avoid redundant seeks)
  const GROUPING_THRESHOLD_SECONDS = 3.0;
  const groups: Array<{ start: number; end: number; timestamps: number[] }> = [];
  
  const sortedRanges = [...ranges].sort((a, b) => a.start - b.start);
  
  let currentGroup = { 
    start: sortedRanges[0].start, 
    end: sortedRanges[0].end,
    timestamps: [sortedRanges[0].centerTimestamp] 
  };
  
  for (let i = 1; i < sortedRanges.length; i++) {
    const range = sortedRanges[i];
    
    if (range.start - currentGroup.end <= GROUPING_THRESHOLD_SECONDS) {
      // Merge into current group
      currentGroup.end = Math.max(currentGroup.end, range.end);
      currentGroup.timestamps.push(range.centerTimestamp);
    } else {
      // Start new group
      groups.push(currentGroup);
      currentGroup = { 
        start: range.start, 
        end: range.end,
        timestamps: [range.centerTimestamp] 
      };
    }
  }
  groups.push(currentGroup);

  console.log(`📦 Grouped ${timestamps.length} refinement windows into ${groups.length} batches`);

  // Step 3: Extract groups in parallel with limited concurrency
  const allFrames: ExtractedFrame[] = [];
  
  for (let i = 0; i < groups.length; i += concurrency) {
    const batch = groups.slice(i, i + concurrency);
    const batchNumber = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(groups.length / concurrency);
    
    console.log(`🔄 Processing refinement batch ${batchNumber}/${totalBatches} (${batch.length} groups, ${batch.reduce((sum, g) => sum + g.timestamps.length, 0)} timestamps)...`);
    
    const batchPromises = batch.map(group => 
      extractFramesInTimeRange(videoUrl, group.start, group.end, fps)
    );
    
    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(frames => allFrames.push(...frames));
  }

  console.log(`✅ Extracted ${allFrames.length} refinement frames from ${groups.length} regional seeks`);
  return allFrames;
}
