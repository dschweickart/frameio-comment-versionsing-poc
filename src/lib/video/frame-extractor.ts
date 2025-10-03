import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { generateFrameHash, type FrameHash } from '../ai/perceptual-hash';

// Helper to find FFmpeg/ffprobe binaries
// Priority: 1. System binaries (/usr/bin) 2. npm static binaries 3. PATH
// Railway: Uses apt-installed ffmpeg via RAILPACK_DEPLOY_APT_PACKAGES
function findBinary(name: 'ffmpeg' | 'ffprobe'): string {
  // 1. Check system binaries (Railway with RAILPACK_DEPLOY_APT_PACKAGES)
  const systemPath = `/usr/bin/${name}`;
  if (existsSync(systemPath)) {
    console.log(`✅ Using system ${name}: ${systemPath}`);
    return systemPath;
  }

  // 2. Try npm static binaries (for local development)
  try {
    if (name === 'ffmpeg') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffmpegPath = require('ffmpeg-static');
      if (ffmpegPath && existsSync(ffmpegPath)) {
        console.log(`✅ Using static ${name}: ${ffmpegPath}`);
        return ffmpegPath;
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffprobePath = require('ffprobe-static');
      const binaryPath = typeof ffprobePath === 'object' && ffprobePath?.path 
        ? ffprobePath.path 
        : ffprobePath;
      if (binaryPath && existsSync(binaryPath)) {
        console.log(`✅ Using static ${name}: ${binaryPath}`);
        return binaryPath;
      }
    }
  } catch (error) {
    console.warn(`⚠️ Static ${name} not available:`, error);
  }

  // 3. Fall back to PATH
  console.log(`⚠️ Using ${name} from PATH`);
  return name;
}

const FFMPEG_BIN = findBinary('ffmpeg');
const FFPROBE_BIN = findBinary('ffprobe');

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
 * Parse a PNG stream buffer into individual frame buffers
 * PNG is lossless, preserving full image quality for accurate perceptual hashing
 * PNG signature: 89 50 4E 47 0D 0A 1A 0A, IEND: 49 45 4E 44 AE 42 60 82
 * 
 * NOTE: This function is deprecated in favor of inline streaming parsing in extractAllFrames()
 * which processes frames as they arrive to minimize memory usage.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function parsePngStream(
  streamBuffer: Buffer,
  knownFrameNumbers?: number[]
): ExtractedFrame[] {
  const frames: ExtractedFrame[] = [];
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A (8 bytes)
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  // IEND chunk (marks end of PNG): 49 45 4E 44 AE 42 60 82
  const PNG_IEND = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);

  let currentPos = 0;
  let frameIndex = 0;

  while (currentPos < streamBuffer.length) {
    // Find start of PNG
    const startPos = streamBuffer.indexOf(PNG_SIGNATURE, currentPos);
    if (startPos === -1) break;

    // Find IEND chunk (search after start position + signature length)
    const iendPos = streamBuffer.indexOf(PNG_IEND, startPos + PNG_SIGNATURE.length);
    if (iendPos === -1) break;

    // Extract frame (include IEND chunk + 4 bytes CRC)
    const endPos = iendPos + PNG_IEND.length;
    const frameBuffer = streamBuffer.subarray(startPos, endPos);
    
    frames.push({
      frameNumber: knownFrameNumbers ? knownFrameNumbers[frameIndex] : frameIndex,
      buffer: frameBuffer,
    });

    frameIndex++;
    currentPos = endPos;
  }

  return frames;
}

/**
 * Parse a JPEG stream buffer into individual frame buffers
 * JPEG markers: FF D8 (start) and FF D9 (end)
 * 
 * DEPRECATED: Use parsePngStream for lossless extraction
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
/**
 * Extract ALL frames from video with inline perceptual hashing
 * Uses streaming + queue-based processing to minimize memory usage
 * 
 * Architecture:
 * 1. FFmpeg stdout → Extract complete PNG frames synchronously → frameQueue[]
 * 2. Async processor → Hash batches of 10 frames in parallel → hashes[]
 * 3. Only 16-byte hashes stored (not 20KB PNG buffers)
 * 
 * This is FASTER than sparse extraction because:
 * - One continuous HTTP session (no reconnection overhead)
 * - Sequential decode (no seeking penalty)
 * - Inline hashing keeps memory usage low (~2MB vs 4.5GB)
 * - Parallel hashing (10 concurrent) keeps up with extraction
 * 
 * Memory profile:
 * - chunks[]: ~320KB (raw FFmpeg output accumulator)
 * - frameQueue[]: ~1MB (10-50 PNGs waiting to be hashed)
 * - hashes[]: ~500KB (31,200 * 16 bytes for full video)
 * - Total peak: ~2MB (vs 4.5GB if storing all frames)
 * 
 * @param videoUrl - URL to video file
 * @param fps - Native FPS of the video
 * @param decimationFactor - Extract every Nth frame (1 = all frames, 2 = every other frame, etc.)
 * @returns Array of FrameHash objects (16 bytes each, not full frames)
 */
export async function extractAllFrames(
  videoUrl: string,
  fps: number,
  decimationFactor: number = 1
): Promise<FrameHash[]> {
  return new Promise(async (resolve, reject) => {
    try {
      const metadata = await getVideoMetadata(videoUrl);
      const totalFrames = Math.floor(metadata.duration * fps);
      const extractedFrames = Math.floor(totalFrames / decimationFactor);
      
      console.log(
        `📹 Streaming all frames from ${metadata.duration.toFixed(1)}s video ` +
        `(${extractedFrames.toLocaleString()} frames @ 320p, decimation: ${decimationFactor}x)...`
      );
      const startTime = Date.now();
      
      // Queue for extracted PNG buffers (waiting to be hashed)
      const frameQueue: Array<{ frameNumber: number; timestamp: number; buffer: Buffer }> = [];
      const hashes: FrameHash[] = [];
      let frameIndex = 0;
      let chunks: Buffer[] = [];
      let processingActive = false;
      let lastProgressLog = Date.now();
      
      const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const PNG_IEND = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);

      // Async worker: Process frames from queue in batches
      async function processQueue() {
        if (processingActive || frameQueue.length === 0) return;
        processingActive = true;
        
        // Process up to 10 frames in parallel for optimal CPU utilization
        const batch = frameQueue.splice(0, 10);
        
        try {
          const batchHashes = await Promise.all(
            batch.map(({ frameNumber, timestamp, buffer }) => 
              generateFrameHash(buffer, frameNumber, timestamp)
            )
          );
          
          hashes.push(...batchHashes);
        } catch (error) {
          console.error('❌ Batch hashing failed:', error);
          reject(error);
          return;
        }
        
        processingActive = false;
        
        // Continue processing if more frames available
        if (frameQueue.length > 0) {
          setImmediate(() => processQueue());
        }
      }

      // Use fps filter to decimate: fps=24/2 extracts every 2nd frame from 24fps source
      const fpsFilter = decimationFactor > 1 
        ? `fps=${fps}/${decimationFactor},scale=320:-1` 
        : `scale=320:-1`;
      
      // Spawn FFmpeg process with streaming output
      // Using PNG for lossless compression to preserve matching accuracy
      const args = [
        '-i', videoUrl,
        '-vf', fpsFilter,
        '-f', 'image2pipe',
        '-c:v', 'png',
        '-'
      ];

      const ffmpeg = spawn(FFMPEG_BIN, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Data handler: Extract PNGs synchronously (NO AWAIT - critical for stream throughput)
      ffmpeg.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        let searchPos = 0;
        
        while (true) {
          // Find complete PNG (signature → IEND marker)
          const pngStart = buffer.indexOf(PNG_SIGNATURE, searchPos);
          if (pngStart === -1) break;
          
          const pngEnd = buffer.indexOf(PNG_IEND, pngStart + 8);
          if (pngEnd === -1) break;  // Incomplete PNG, wait for more data
          
          const frameEnd = pngEnd + 8;  // IEND is 8 bytes
          const frameBuffer = buffer.subarray(pngStart, frameEnd);
          
          // Calculate frame metadata
          const timePerFrame = (1 / fps) * decimationFactor;
          const timestamp = frameIndex * timePerFrame;
          const frameNumber = frameIndex * decimationFactor;
          
          // Add to queue (sync operation - no blocking)
          frameQueue.push({
            frameNumber,
            timestamp,
            buffer: frameBuffer,
          });
          
          frameIndex++;
          searchPos = frameEnd;
          
          // Log progress every 5 seconds
          const now = Date.now();
          if (now - lastProgressLog > 5000) {
            const elapsed = (now - startTime) / 1000;
            const queueSize = frameQueue.length;
            const hashesGenerated = hashes.length;
            console.log(
              `   Processing... ${frameIndex.toLocaleString()} frames extracted, ` +
              `${hashesGenerated.toLocaleString()} hashed (queue: ${queueSize}), ` +
              `${elapsed.toFixed(1)}s elapsed`
            );
            lastProgressLog = now;
          }
        }
        
        // Cleanup: Keep only unprocessed bytes (always reset, even if searchPos === 0)
        chunks = [buffer.subarray(searchPos)];
        
        // Trigger async processing (non-blocking)
        setImmediate(() => processQueue());
      });

      ffmpeg.stderr.on('data', (data: Buffer) => {
        const message = data.toString();
        if (message.includes('Error') || message.includes('error')) {
          console.error('FFmpeg stderr:', message);
        }
      });

      ffmpeg.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg process exited with code ${code}`));
          return;
        }

        try {
          // Wait for remaining frames to be hashed
          while (frameQueue.length > 0 || processingActive) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          
          const duration = Date.now() - startTime;
          const realtimeRatio = metadata.duration / (duration / 1000);
          
          console.log(
            `✅ Streamed and hashed ${hashes.length.toLocaleString()} frames in ${(duration / 1000).toFixed(1)}s ` +
            `(${realtimeRatio.toFixed(1)}x realtime)`
          );

          console.log(`✅ All frames hashed and ready for matching (${hashes.length.toLocaleString()} hashes, ~${(hashes.length * 16 / 1024).toFixed(0)}KB)`);
          resolve(hashes);
        } catch (error) {
          reject(error);
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg spawn error: ${error.message}`));
      });

    } catch (error) {
      console.error('❌ FFmpeg all-frames extraction failed:', error);
      reject(new Error(`Failed to extract all frames: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}

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
    
    const metadata = await getVideoMetadata(videoUrl);
    console.log(`📹 Extracting I-frames from ${metadata.duration.toFixed(1)}s video (this may take 10-30s for long videos)...`);
    const startTime = Date.now();
    
    const jpegStream = execSync(ffmpegCommand, {
      encoding: 'buffer',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer (downscaled frames are much smaller)
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const duration = Date.now() - startTime;
    console.log(`✅ FFmpeg completed in ${(duration / 1000).toFixed(1)}s (${(metadata.duration / (duration / 1000)).toFixed(1)}x realtime), parsing frames...`);

    const frames = parseJpegStream(jpegStream);
    
    // For I-frames, we don't know exact frame numbers ahead of time
    // FFmpeg outputs them sequentially, so we estimate timestamps
    // based on uniform distribution (we'll refine this if needed)
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
