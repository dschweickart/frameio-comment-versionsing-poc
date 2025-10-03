import { db } from '@/lib/db';
import { processingJobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { 
  extractFramesWithSeeking,
  extractIFrames,
  extractRefinementFrames,
  getVideoMetadata,
  REFINEMENT_WINDOW_SECONDS
} from './frame-extractor';
import { generateFrameHashes, hammingDistance, hashSimilarity, type FrameHash } from '../ai/perceptual-hash';
import { FrameioClient, FrameioComment } from '@/lib/frameio-client';

export interface ProcessingOptions {
  accountId: string;
  sourceFileId: string;
  targetFileId: string;
  jobId: string;
}

export interface TargetVideoContext {
  videoUrl: string;
  metadata: { width: number; height: number; fps: number; duration: number };
  keyframeHashes: FrameHash[];
}

export interface CommentMatch {
  sourceComment: FrameioComment;
  targetFrameNumber: number;
  targetTimestamp: number;
  hammingDistance: number;
  similarity: number;
}

/**
 * Main frame processing pipeline with time-based matching
 * 
 * OPTIMIZED APPROACH:
 * - Source frames: Use -ss seeking (parallel HTTP range requests, ~3-5s for 42 frames)
 * - Target keyframes: Use I-frame extraction (adaptive density, fast)
 * - Refinement: Time-based with -ss seeking for HTTP range requests
 * - Video proxy: Use "efficient" for faster downloads
 * 
 * Workflow:
 * 1. Extract source frames using parallel -ss seeks
 * 2. Extract target I-frames (natural encoding keyframes)
 * 3. Coarse match: Find best target timestamp for each source comment
 * 4. Refinement: Extract ±0.5s around coarse matches with -ss seeking
 * 5. Fine match: Find frame-accurate match within refinement window
 * 6. Convert target timestamps to frame numbers for Frame.io API
 */
export class FrameProcessor {
  private client: FrameioClient;
  
  constructor(client: FrameioClient) {
    this.client = client;
  }

  /**
   * Prepare target video (extract I-frames and generate hashes)
   * This is done once upfront, then reused for all comment batches
   */
  async prepareTargetVideo(
    accountId: string,
    targetFileId: string,
    jobId: string
  ): Promise<TargetVideoContext> {
    console.log('\n🎬 Preparing target video (one-time setup)...');
    
    await this.updateJobProgress(jobId, 'processing', 0.1, 'Fetching target video...');
    const targetFile = await this.client.getFileWithMediaLinks(accountId, targetFileId);
    const targetVideoUrl = targetFile.media_links?.efficient?.download_url;
    
    if (!targetVideoUrl) {
      throw new Error('Target file has no efficient proxy available');
    }

    const metadata = await getVideoMetadata(targetVideoUrl);
    console.log(`📹 Target: ${metadata.width}x${metadata.height}, ${metadata.fps}fps, ${metadata.duration}s`);

    await this.updateJobProgress(jobId, 'processing', 0.2, 'Extracting target I-frames...');
    const keyframes = await extractIFrames(targetVideoUrl, metadata.fps);
    console.log(`✅ Extracted ${keyframes.length} I-frames`);

    await this.updateJobProgress(jobId, 'processing', 0.3, 'Generating target hashes...');
    const keyframeHashes = await generateFrameHashes(keyframes);
    console.log(`✅ Generated ${keyframeHashes.length} target hashes\n`);

    return {
      videoUrl: targetVideoUrl,
      metadata,
      keyframeHashes,
    };
  }

  /**
   * Process a batch of source comments against prepared target video
   * Returns matches for just this batch
   */
  async processBatch(
    sourceVideoUrl: string,
    sourceFps: number,
    comments: FrameioComment[],
    targetContext: TargetVideoContext,
    batchNumber: number,
    totalBatches: number
  ): Promise<CommentMatch[]> {
    console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${comments.length} comments)...`);

    // Extract source frames for this batch using -ss seeking
    const commentFrameNumbers = comments
      .filter(c => c.timestamp !== undefined)
      .map(c => c.timestamp!);

    const sourceFrameData = await extractFramesWithSeeking(
      sourceVideoUrl,
      commentFrameNumbers,
      sourceFps,
      4 // 4 parallel requests
    );
    console.log(`  ✅ Extracted ${sourceFrameData.length} source frames`);

    // Generate hashes for source frames
    const sourceHashes = await generateFrameHashes(sourceFrameData);
    console.log(`  ✅ Generated ${sourceHashes.length} source hashes`);

    // Coarse matching against target keyframes
    // Match each source hash with its corresponding comment
    const coarseMatches: Array<{
      sourceComment: FrameioComment;
      targetTimestamp: number;
      hammingDistance: number;
      similarity: number;
    }> = [];

    for (let i = 0; i < sourceHashes.length; i++) {
      const sourceHash = sourceHashes[i];
      const comment = comments[i];
      
      let bestMatch = {
        targetTimestamp: 0,
        distance: Infinity,
        similarity: 0,
      };

      for (const targetHash of targetContext.keyframeHashes) {
        const distance = hammingDistance(sourceHash.hash, targetHash.hash);
        const similarity = hashSimilarity(sourceHash.hash, targetHash.hash);

        if (distance < bestMatch.distance) {
          bestMatch = {
            targetTimestamp: targetHash.timestamp!,
            distance,
            similarity,
          };
        }
      }

      coarseMatches.push({
        sourceComment: comment,
        targetTimestamp: bestMatch.targetTimestamp,
        hammingDistance: bestMatch.distance,
        similarity: bestMatch.similarity,
      });
    }
    
    console.log(`  ✅ Found ${coarseMatches.length} coarse matches`);

    // Refinement
    const refinementTimestamps = coarseMatches.map(m => m.targetTimestamp);
    const refinementFrames = await extractRefinementFrames(
      targetContext.videoUrl,
      refinementTimestamps,
      targetContext.metadata.fps,
      REFINEMENT_WINDOW_SECONDS,
      4 // 4 concurrent processes
    );
    console.log(`  ✅ Extracted ${refinementFrames.length} refinement frames`);

    const refinementHashes = await generateFrameHashes(refinementFrames);
    console.log(`  ✅ Generated ${refinementHashes.length} refinement hashes`);

    // Refine each match
    const finalMatches: CommentMatch[] = [];
    
    for (const coarseMatch of coarseMatches) {
      const sourceHash = sourceHashes.find(h => h.frameNumber === coarseMatch.sourceComment.timestamp);
      
      if (!sourceHash) continue;

      let bestMatch = {
        timestamp: coarseMatch.targetTimestamp,
        distance: coarseMatch.hammingDistance,
        similarity: coarseMatch.similarity,
      };

      const windowStart = coarseMatch.targetTimestamp - REFINEMENT_WINDOW_SECONDS;
      const windowEnd = coarseMatch.targetTimestamp + REFINEMENT_WINDOW_SECONDS;
      
      for (const refHash of refinementHashes) {
        if (refHash.timestamp && refHash.timestamp >= windowStart && refHash.timestamp <= windowEnd) {
          const distance = hammingDistance(sourceHash.hash, refHash.hash);
          const similarity = hashSimilarity(sourceHash.hash, refHash.hash);
          
          if (distance < bestMatch.distance) {
            bestMatch = {
              timestamp: refHash.timestamp,
              distance,
              similarity,
            };
          }
        }
      }

      const targetFrameNumber = Math.round(bestMatch.timestamp * targetContext.metadata.fps);
      
      finalMatches.push({
        sourceComment: coarseMatch.sourceComment,
        targetFrameNumber,
        targetTimestamp: bestMatch.timestamp,
        hammingDistance: bestMatch.distance,
        similarity: bestMatch.similarity,
      });
    }

    console.log(`  ✅ Batch ${batchNumber} complete: ${finalMatches.length} matches ready\n`);
    return finalMatches;
  }

  /**
   * Process source and target videos to match comments (legacy method - kept for compatibility)
   */
  async processVideos(options: ProcessingOptions): Promise<CommentMatch[]> {
    const { accountId, sourceFileId, targetFileId, jobId } = options;

    try {
      // ========== PHASE 1: SOURCE VIDEO PROCESSING (Frame-based with -ss seeking) ==========
      
      await this.updateJobProgress(jobId, 'processing', 0.1, 'Fetching source video metadata...');
      const sourceFile = await this.client.getFileWithMediaLinks(accountId, sourceFileId);
      const sourceComments = await this.client.getFileComments(accountId, sourceFileId);

      if (!sourceComments || sourceComments.length === 0) {
        throw new Error('No comments found on source file');
      }

      console.log(`Found ${sourceComments.length} comments on source file`);

      await this.updateJobProgress(jobId, 'processing', 0.2, 'Processing source video...');
      const sourceVideoUrl = sourceFile.media_links?.efficient?.download_url;
      if (!sourceVideoUrl) {
        throw new Error('Source file has no efficient proxy available');
      }

      const sourceMetadata = await getVideoMetadata(sourceVideoUrl);
      console.log(`Source video: ${sourceMetadata.width}x${sourceMetadata.height}, ${sourceMetadata.fps}fps, ${sourceMetadata.duration}s`);

      // Extract frames at comment timestamps using -ss seeking (parallel HTTP range requests)
      await this.updateJobProgress(jobId, 'processing', 0.3, `Extracting ${sourceComments.length} frames from source...`);
      const commentFrameNumbers = sourceComments
        .filter(comment => comment.timestamp !== undefined)
        .map(comment => comment.timestamp!);

      const sourceFrameData = await extractFramesWithSeeking(
        sourceVideoUrl, 
        commentFrameNumbers,
        sourceMetadata.fps,
        4 // 4 parallel requests
      );
      console.log(`Extracted ${sourceFrameData.length} frames from source video`);

      // Generate hashes for source frames
      await this.updateJobProgress(jobId, 'processing', 0.4, 'Generating hashes for source frames...');
      const sourceHashes = await generateFrameHashes(sourceFrameData);
      console.log(`Generated ${sourceHashes.length} hashes for source frames`);

      // ========== PHASE 2: TARGET VIDEO PROCESSING (ALL frames for frame-perfect matching) ==========
      
      await this.updateJobProgress(jobId, 'processing', 0.6, 'Processing target video...');
      const targetFile = await this.client.getFileWithMediaLinks(accountId, targetFileId);
      const targetVideoUrl = targetFile.media_links?.efficient?.download_url;
      
      if (!targetVideoUrl) {
        throw new Error('Target file has no efficient proxy available');
      }

      const targetMetadata = await getVideoMetadata(targetVideoUrl);
      console.log(`Target video: ${targetMetadata.width}x${targetMetadata.height}, ${targetMetadata.fps}fps, ${targetMetadata.duration}s`);

      // Extract ALL frames from target with inline hashing (much faster than I-frames + refinement)
      // Using decimation factor of 1 = every frame for frame-perfect accuracy
      // Frames are hashed inline during extraction to minimize memory usage (~2MB vs 4.5GB)
      await this.updateJobProgress(jobId, 'processing', 0.7, 'Extracting and hashing all frames from target...');
      const { extractAllFrames } = await import('./frame-extractor');
      const targetHashes = await extractAllFrames(
        targetVideoUrl,
        targetMetadata.fps,
        1 // Extract every frame for maximum accuracy
      );
      console.log(`Extracted and hashed ${targetHashes.length} frames from target`);

      // ========== PHASE 3: FRAME-PERFECT MATCHING ==========
      // Since we extracted ALL frames, no refinement needed - we already have frame-perfect accuracy!
      
      await this.updateJobProgress(jobId, 'processing', 0.8, 'Finding frame-perfect matches...');
      const matches = this.matchSourceToTarget(sourceHashes, targetHashes);
      
      console.log(`\n📊 Frame-Perfect Matching Results:`);
      console.log(`   Found ${matches.length} matches`);
      
      // Convert to final format with frame numbers
      const finalMatches: CommentMatch[] = matches.map(match => {
        // Convert timestamp to frame number for Frame.io API
        const targetFrameNumber = Math.round(match.targetTimestamp * targetMetadata.fps);
        
        console.log(`  Comment "${match.sourceComment.text?.substring(0, 50)}..."`);
        console.log(`    Source: frame ${match.sourceComment.timestamp}`);
        console.log(`    Match: ${match.targetTimestamp.toFixed(2)}s → frame ${targetFrameNumber} (${(match.similarity * 100).toFixed(1)}% similarity)`);
        
        return {
          sourceComment: match.sourceComment,
          targetFrameNumber,
          targetTimestamp: match.targetTimestamp,
          hammingDistance: match.hammingDistance,
          similarity: match.similarity,
        };
      });

      await this.updateJobProgress(jobId, 'processing', 0.9, `Matched ${finalMatches.length} comments`);
      console.log(`\n✅ Frame processing complete: ${finalMatches.length} matches found\n`);
      
      return finalMatches;

    } catch (error) {
      console.error('❌ Video processing failed:', error);
      throw error;
    }
  }

  /**
   * Find coarse matches between source and target frames
   */
  private matchSourceToTarget(
    sourceHashes: FrameHash[],
    targetHashes: FrameHash[]
  ): Array<{
    sourceComment: FrameioComment;
    targetTimestamp: number;
    hammingDistance: number;
    similarity: number;
  }> {
    const matches: Array<{
      sourceComment: FrameioComment;
      targetTimestamp: number;
      hammingDistance: number;
      similarity: number;
    }> = [];

    for (const sourceHash of sourceHashes) {
      let bestMatch = {
        targetTimestamp: 0,
        distance: Infinity,
        similarity: 0,
      };

      for (const targetHash of targetHashes) {
        const distance = hammingDistance(sourceHash.hash, targetHash.hash);
        const similarity = hashSimilarity(sourceHash.hash, targetHash.hash);

        if (distance < bestMatch.distance) {
          bestMatch = {
            targetTimestamp: targetHash.timestamp!,
            distance,
            similarity,
          };
        }
      }

      // Create a minimal comment object for matching
      const comment: FrameioComment = {
        id: '', // Will be filled in later
        text: `Frame ${sourceHash.frameNumber}`,
        timestamp: sourceHash.frameNumber,
        owner: { id: '', name: '' },
        page: undefined,
        annotation: undefined,
        asset_id: '', // Will be filled in later
      };

      matches.push({
        sourceComment: comment,
        targetTimestamp: bestMatch.targetTimestamp,
        hammingDistance: bestMatch.distance,
        similarity: bestMatch.similarity,
      });
    }

    return matches;
  }

  /**
   * Update job progress in database
   */
  private async updateJobProgress(
    jobId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    progress: number,
    message: string
  ): Promise<void> {
    await db
      .update(processingJobs)
      .set({
        status,
        progress: progress.toString(),
        message,
      })
      .where(eq(processingJobs.id, jobId));

    console.log(`[${(progress * 100).toFixed(0)}%] ${message}`);
  }
}