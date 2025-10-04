import sharp from 'sharp';

export interface FrameHash {
  frameNumber?: number;  // For source frames (Frame.io uses frame numbers)
  timestamp?: number;    // For target frames (in seconds)
  hash: string;          // 256-character hex string for 1024-bit hash
}

export interface MatchResult {
  action: 'transfer' | 'skip' | 'needs_refinement';
  targetFrame?: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  reason: string;
  candidates?: Array<{ frame: number; distance: number }>;
}

/**
 * Generate a high-resolution perceptual hash (dHash) for a video frame
 * 
 * dHash (Difference Hash) works by:
 * 1. Resize to 33x32 pixels (to get 32x32 gradients)
 * 2. Convert to grayscale
 * 3. Compare each pixel to the one on its right
 * 4. Build a 1024-bit hash from the comparison results
 * 
 * Benefits:
 * - ⚡ Still fast (~2-3ms per frame)
 * - 🆓 Free (no API calls)
 * - 💾 128 bytes storage (16x more detail than 64-bit)
 * - ✅ Better handles motion blur, similar frames, re-encoding artifacts
 * - 🎯 Improved accuracy for challenging matches
 * 
 * Storage: Hash is stored as 256-character hex string (1024 bits)
 */
export async function generateFrameHash(
  frameBuffer: Buffer,
  frameNumber?: number,
  timestamp?: number
): Promise<FrameHash> {
  // Removed per-frame logging to avoid Railway rate limits (500 logs/sec)
  // Summary stats are logged by generateFrameHashes() batch function
  
  try {
    // Step 1: Resize to 33x32 and convert to grayscale (32x32 = 1024 bits)
    const resized = await sharp(frameBuffer)
      .resize(33, 32, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    // Step 2: Calculate dHash by comparing adjacent pixels
    let hash = 0n;
    let bitIndex = 0;

    for (let row = 0; row < 32; row++) {
      for (let col = 0; col < 32; col++) {
        const leftIndex = row * 33 + col;
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

    // Convert to hex string (256 characters for 1024 bits)
    const hashString = hash.toString(16).padStart(256, '0');

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
 * Returns number of differing bits (0-1024 for 1024-bit hashes)
 * 
 * Interpretation (for 1024-bit hashes):
 * - 0-80: Nearly identical frames (~92%+ similar)
 * - 81-160: Very similar frames (~84-92% similar)
 * - 161-320: Similar frames (~69-84% similar)
 * - 321-400: Moderately similar (~61-69% similar)
 * - 401+: Different frames (<61% similar)
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
  return 1 - (distance / 1024);
}

/**
 * Match source frame to target frames with confidence scoring
 * Handles ambiguous content (motion blur, similar frames, re-encoding)
 * 
 * @param sourceHash - Hash of the source comment frame
 * @param targetHashes - All target video hashes
 * @returns Match result with action, confidence, and candidates
 */
export function matchWithConfidence(
  sourceHash: FrameHash,
  targetHashes: FrameHash[]
): MatchResult {
  // Sort by Hamming distance (best matches first)
  const sorted = targetHashes
    .map(t => ({ 
      frame: t.frameNumber || 0,
      timestamp: t.timestamp || 0,
      distance: hammingDistance(sourceHash.hash, t.hash) 
    }))
    .sort((a, b) => a.distance - b.distance);
  
  const best = sorted[0];
  const second = sorted[1];
  
  // No plausible match (shot likely deleted from edit)
  // 400/1024 = 61% similarity threshold
  if (best.distance > 400) {
    return {
      action: 'skip',
      confidence: 'none',
      reason: `no_similar_frames_found (best: ${(1 - best.distance / 1024).toFixed(2)})`
    };
  }
  
  // Clear winner - high confidence
  // Gap of 80+ bits = significant difference between 1st and 2nd place
  const gap = second.distance - best.distance;
  if (gap >= 80) {
    return {
      action: 'transfer',
      targetFrame: best.frame,
      confidence: 'high',
      reason: `clear_best_match (${(1 - best.distance / 1024).toFixed(2)} sim, gap: ${gap})`
    };
  }
  
  // Multiple close candidates (within 80 bits)
  const closeMatches = sorted.filter(m => m.distance - best.distance < 80);
  
  // Too many candidates = genuinely ambiguous content
  // Accept best match with low confidence
  if (closeMatches.length > 20) {
    return {
      action: 'transfer',
      targetFrame: best.frame,
      confidence: 'low',
      reason: `ambiguous_content_${closeMatches.length}_similar_frames`
    };
  }
  
  // 2-20 candidates: needs refinement with temporal context
  return {
    action: 'needs_refinement',
    targetFrame: best.frame,
    confidence: 'medium',
    reason: `multiple_candidates (${closeMatches.length} within 80 bits)`,
    candidates: closeMatches.slice(0, 5)
  };
}

/**
 * Refine match using temporal neighbor context (5-frame window)
 * Compares neighbor frames to disambiguate uncertain matches
 * 
 * @param sourceNeighborHashes - 5 hashes centered on source comment frame
 * @param candidates - Top candidate matches from initial matching
 * @param targetHashes - All target video hashes
 * @returns Refined match result with updated confidence
 */
export function refineWithNeighbors(
  sourceNeighborHashes: FrameHash[],
  candidates: Array<{ frame: number; distance: number }>,
  targetHashes: FrameHash[]
): MatchResult {
  if (sourceNeighborHashes.length !== 5) {
    throw new Error('refineWithNeighbors requires exactly 5 neighbor hashes');
  }
  
  // Neighbor offsets: [-5, -1, 0, +1, +5] frames (~0.2s @ 24fps)
  const neighborOffsets = [-5, -1, 0, +1, +5];
  
  // Score each candidate using neighbors
  const scores = candidates.map(candidate => {
    let totalDistance = 0;
    
    for (let i = 0; i < 5; i++) {
      const offset = neighborOffsets[i];
      const targetFrameNum = candidate.frame + offset;
      const targetHash = targetHashes.find(h => h.frameNumber === targetFrameNum);
      
      if (targetHash) {
        totalDistance += hammingDistance(sourceNeighborHashes[i].hash, targetHash.hash);
      } else {
        // Penalty for missing neighbor (edge of video or frame extraction issue)
        totalDistance += 512; // 50% similarity penalty
      }
    }
    
    return { frame: candidate.frame, score: totalDistance };
  }).sort((a, b) => a.score - b.score);
  
  const best = scores[0];
  const second = scores[1];
  const improvementGap = second.score - best.score;
  
  // Strong improvement after refinement
  // 320+ bits across 5 frames = 64+ bits per frame on average
  if (improvementGap >= 320) {
    return {
      action: 'transfer',
      targetFrame: best.frame,
      confidence: 'high',
      reason: `refined_clear_winner (gap: ${improvementGap} bits)`
    };
  }
  
  // Moderate improvement
  if (improvementGap >= 160) {
    return {
      action: 'transfer',
      targetFrame: best.frame,
      confidence: 'medium',
      reason: `refined_likely_match (gap: ${improvementGap} bits)`
    };
  }
  
  // Still ambiguous after refinement
  return {
    action: 'transfer',
    targetFrame: best.frame,
    confidence: 'low',
    reason: `ambiguous_after_refinement (gap: ${improvementGap} bits)`
  };
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
