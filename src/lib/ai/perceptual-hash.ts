import sharp from 'sharp';

export interface FrameHash {
  frameNumber?: number;  // For source frames (Frame.io uses frame numbers)
  timestamp?: number;    // For target frames (in seconds)
  hash: string;          // 256-character hex string for 1024-bit hash
  avgBrightness?: number; // Average brightness (0-255) for black frame detection
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

    // Step 2: Calculate average brightness for black frame detection
    let totalBrightness = 0;
    for (let i = 0; i < resized.length; i++) {
      totalBrightness += resized[i];
    }
    const avgBrightness = Math.round(totalBrightness / resized.length);

    // Step 3: Calculate dHash by comparing adjacent pixels
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
      avgBrightness,
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
 * Special handling for black frames with temporal position preference
 * 
 * @param sourceHash - Hash of the source comment frame
 * @param targetHashes - All target video hashes
 * @param videoDuration - Duration of video in seconds (for edge detection)
 * @returns Match result with action, confidence, and candidates
 */
export function matchWithConfidence(
  sourceHash: FrameHash,
  targetHashes: FrameHash[],
  videoDuration?: number
): MatchResult {
  // Detect black frames (average brightness < 30 out of 255)
  const BLACK_THRESHOLD = 30;
  const EDGE_WINDOW_SECONDS = 10; // First/last 10 seconds
  
  const isBlackFrame = sourceHash.avgBrightness !== undefined && sourceHash.avgBrightness < BLACK_THRESHOLD;
  const sourceTimestamp = sourceHash.timestamp ?? (sourceHash.frameNumber ? sourceHash.frameNumber / 24 : 0);
  const isNearEdge = videoDuration && (sourceTimestamp < EDGE_WINDOW_SECONDS || sourceTimestamp > videoDuration - EDGE_WINDOW_SECONDS);
  
  // Sort by Hamming distance (best matches first)
  const sorted = targetHashes
    .map(t => ({ 
      frame: t.frameNumber || 0,
      timestamp: t.timestamp || 0,
      distance: hammingDistance(sourceHash.hash, t.hash),
      avgBrightness: t.avgBrightness || 0
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
  
  // Black frame edge case handling
  // If source is black AND near first/last 10s AND multiple targets are equally black
  if (isBlackFrame && isNearEdge && best.avgBrightness < BLACK_THRESHOLD) {
    // Find all nearly-identical black frames (distance within 5 bits)
    const identicalBlacks = sorted.filter(m => 
      m.avgBrightness < BLACK_THRESHOLD && m.distance - best.distance < 5
    );
    
    if (identicalBlacks.length > 1) {
      // Prefer the frame closest to original temporal position
      const preferredMatch = identicalBlacks.reduce((prev, curr) => {
        const prevDiff = Math.abs(prev.timestamp - sourceTimestamp);
        const currDiff = Math.abs(curr.timestamp - sourceTimestamp);
        return currDiff < prevDiff ? curr : prev;
      });
      
      return {
        action: 'transfer',
        targetFrame: preferredMatch.frame,
        confidence: 'low',
        reason: `black_frame_temporal_preference (${identicalBlacks.length} identical blacks, chose nearest to original position)`
      };
    }
  }
  
  // Clear winner - high confidence
  // Gap of 50+ bits = significant difference between 1st and 2nd place (about 5% difference)
  const gap = second.distance - best.distance;
  if (gap >= 50) {
    return {
      action: 'transfer',
      targetFrame: best.frame,
      confidence: 'high',
      reason: `clear_winner (${(1 - best.distance / 1024).toFixed(3)} sim, ${gap} bit gap)`
    };
  }
  
  // Multiple close candidates (within 50 bits)
  const closeMatches = sorted.filter(m => m.distance - best.distance < 50);
  
  // Too many candidates = genuinely ambiguous content
  // Accept best match with low confidence
  if (closeMatches.length > 15) {
    return {
      action: 'transfer',
      targetFrame: best.frame,
      confidence: 'low',
      reason: `ambiguous_${closeMatches.length}_similar_frames (${(1 - best.distance / 1024).toFixed(3)} sim)`
    };
  }
  
  // 2-15 candidates: needs refinement with temporal context
  return {
    action: 'needs_refinement',
    targetFrame: best.frame,
    confidence: 'medium',
    reason: `needs_refinement (${closeMatches.length} candidates within 50 bits)`,
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
  // 200+ bits across 5 frames = 40+ bits per frame on average
  if (improvementGap >= 200) {
    return {
      action: 'transfer',
      targetFrame: best.frame,
      confidence: 'high',
      reason: `refined_strong (${improvementGap} bit gap)`
    };
  }
  
  // Moderate improvement - testing shows these are still accurate
  if (improvementGap >= 80) {
    return {
      action: 'transfer',
      targetFrame: best.frame,
      confidence: 'medium',
      reason: `refined_moderate (${improvementGap} bit gap)`
    };
  }
  
  // Small improvement - likely ambiguous content (static shots, similar frames)
  return {
    action: 'transfer',
    targetFrame: best.frame,
    confidence: 'low',
    reason: `refined_weak (${improvementGap} bit gap)`
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
