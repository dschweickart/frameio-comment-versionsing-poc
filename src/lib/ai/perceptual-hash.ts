import sharp from 'sharp';

export interface FrameHash {
  frameNumber?: number;  // For source frames (Frame.io uses frame numbers)
  timestamp?: number;    // For target frames (in seconds)
  hash: string;          // 16-character hex string for 64-bit hash
}

/**
 * Generate a perceptual hash (dHash) for a video frame
 * 
 * dHash (Difference Hash) works by:
 * 1. Resize to 9x8 pixels (to get 8x8 gradients)
 * 2. Convert to grayscale
 * 3. Compare each pixel to the one on its right
 * 4. Build a 64-bit hash from the comparison results
 * 
 * Benefits:
 * - ⚡ ~1ms per frame (500x faster than AI embeddings)
 * - 🆓 Free (no API calls)
 * - 💾 8 bytes storage (vs 12KB for embeddings)
 * - ✅ Excellent for finding duplicate/similar frames
 * 
 * Storage: Hash is stored as 16-character hex string
 */
export async function generateFrameHash(
  frameBuffer: Buffer,
  frameNumber?: number,
  timestamp?: number
): Promise<FrameHash> {
  // Removed per-frame logging to avoid Railway rate limits (500 logs/sec)
  // Summary stats are logged by generateFrameHashes() batch function
  
  try {
    // Step 1: Resize to 9x8 and convert to grayscale
    const resized = await sharp(frameBuffer)
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    // Step 2: Calculate dHash by comparing adjacent pixels
    let hash = 0n;
    let bitIndex = 0;

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const leftIndex = row * 9 + col;
        const rightIndex = leftIndex + 1;
        
        const leftPixel = resized[leftIndex];
        const rightPixel = resized[rightIndex];
        
        // If left pixel is brighter than right, set bit to 1
        if (leftPixel > rightPixel) {
          hash |= 1n << BigInt(bitIndex);
        }
        
        bitIndex++;
      }
    }

    // Convert to hex string (16 characters for 64 bits)
    const hashString = hash.toString(16).padStart(16, '0');

    return {
      frameNumber,
      timestamp,
      hash: hashString,
    };
  } catch (error) {
    const identifier = frameNumber !== undefined ? `frame ${frameNumber}` : `timestamp ${timestamp?.toFixed(2)}s`;
    console.error(`❌ Failed to generate hash for ${identifier}:`, error);
    throw new Error(
      `Hash generation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Calculate Hamming distance between two perceptual hashes
 * Returns number of differing bits (0-64)
 * 
 * Interpretation:
 * - 0-5: Nearly identical frames
 * - 6-10: Very similar frames
 * - 11-20: Similar frames
 * - 21+: Different frames
 */
export function hammingDistance(hash1: string, hash2: string): number {
  const bits1 = BigInt('0x' + hash1);
  const bits2 = BigInt('0x' + hash2);
  
  // XOR to find differing bits
  let xor = bits1 ^ bits2;
  
  // Count set bits
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  
  return distance;
}

/**
 * Calculate similarity score between two hashes (0-1, where 1 is identical)
 */
export function hashSimilarity(hash1: string, hash2: string): number {
  const distance = hammingDistance(hash1, hash2);
  return 1 - (distance / 64);
}

/**
 * Batch generate hashes for multiple frames
 * Supports both frame-based (source) and time-based (target) frames
 */
export async function generateFrameHashes(
  frames: Array<{ frameNumber?: number; timestamp?: number; buffer: Buffer }>
): Promise<FrameHash[]> {
  console.log(`🔍 Generating hashes for ${frames.length} frames...`);
  const startTime = Date.now();
  
  const hashes = await Promise.all(
    frames.map(frame => generateFrameHash(frame.buffer, frame.frameNumber, frame.timestamp))
  );
  
  const duration = Date.now() - startTime;
  console.log(`✅ Generated ${hashes.length} hashes in ${duration}ms (avg: ${(duration / hashes.length).toFixed(1)}ms per frame)`);
  
  return hashes;
}
