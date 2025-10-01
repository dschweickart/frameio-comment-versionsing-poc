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
    const targetFileUrl = `/accounts/${accountId}/files/${targetFileId}?include=media_links.efficient`;
    const targetFileResponse = await this.client.apiRequest(targetFileUrl);
    const targetFile = targetFileResponse.data || targetFileResponse;
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
    const coarseMatches = this.matchSourceToTargetWithComments(
      sourceHashes,
      comments,
      targetContext.keyframeHashes
    );
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
      const sourceFileUrl = `/accounts/${accountId}/files/${sourceFileId}?include=media_links.efficient`;
      const sourceFileResponse = await this.client.apiRequest(sourceFileUrl);
      const sourceFile = sourceFileResponse.data || sourceFileResponse;
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

      // ========== PHASE 2: TARGET VIDEO PROCESSING (I-frame extraction) ==========
      
      await this.updateJobProgress(jobId, 'processing', 0.6, 'Processing target video...');
      const targetFileUrl = `/accounts/${accountId}/files/${targetFileId}?include=media_links.efficient`;
      const targetFileResponse = await this.client.apiRequest(targetFileUrl);
      const targetFile = targetFileResponse.data || targetFileResponse;
      const targetVideoUrl = targetFile.media_links?.efficient?.download_url;
      
      if (!targetVideoUrl) {
        throw new Error('Target file has no efficient proxy available');
      }

      const targetMetadata = await getVideoMetadata(targetVideoUrl);
      console.log(`Target video: ${targetMetadata.width}x${targetMetadata.height}, ${targetMetadata.fps}fps, ${targetMetadata.duration}s`);

      // Extract I-frames (natural encoding keyframes - adaptive density)
      await this.updateJobProgress(jobId, 'processing', 0.7, 'Extracting I-frames from target...');
      const targetKeyframes = await extractIFrames(
        targetVideoUrl,
        targetMetadata.fps
      );
      console.log(`Extracted ${targetKeyframes.length} I-frames from target`);

      // Generate hashes for target I-frames
      await this.updateJobProgress(jobId, 'processing', 0.75, 'Generating hashes for target I-frames...');
      const targetHashes = await generateFrameHashes(targetKeyframes);
      console.log(`Generated ${targetHashes.length} hashes for target I-frames`);

      // ========== PHASE 3: COARSE MATCHING ==========
      
      await this.updateJobProgress(jobId, 'processing', 0.8, 'Finding coarse matches...');
      const coarseMatches = this.matchSourceToTarget(sourceHashes, targetHashes);
      console.log(`\n📊 Coarse Matching Results:`);
      console.log(`   Found ${coarseMatches.length} coarse matches`);
      
      // ========== PHASE 4: REFINEMENT WITH -SS SEEKING ==========
      
      await this.updateJobProgress(jobId, 'processing', 0.85, 'Refining matches...');
      
      // Extract refinement frames using -ss seeking (parallel, HTTP range requests)
      const refinementTimestamps = coarseMatches.map(m => m.targetTimestamp);
      const refinementFrames = await extractRefinementFrames(
        targetVideoUrl,
        refinementTimestamps,
        targetMetadata.fps,
        REFINEMENT_WINDOW_SECONDS,
        4 // 4 concurrent FFmpeg processes
      );

      console.log(`Extracted ${refinementFrames.length} refinement frames`);

      // Generate hashes for refinement frames
      const refinementHashes = await generateFrameHashes(refinementFrames);
      console.log(`Generated ${refinementHashes.length} refinement hashes`);

      // Create lookup map for refinement hashes by timestamp
      const refinementHashMap = new Map<number, FrameHash[]>();
      refinementHashes.forEach(hash => {
        if (hash.timestamp !== undefined) {
          const rounded = parseFloat(hash.timestamp.toFixed(2)); // Round to 0.01s precision
          if (!refinementHashMap.has(rounded)) {
            refinementHashMap.set(rounded, []);
          }
          refinementHashMap.get(rounded)!.push(hash);
        }
      });

      // Refine each match
      const finalMatches: CommentMatch[] = [];
      
      for (let i = 0; i < coarseMatches.length; i++) {
        const coarseMatch = coarseMatches[i];
        const sourceHash = sourceHashes.find(h => h.frameNumber === coarseMatch.sourceComment.timestamp);
        
        if (!sourceHash) continue;

        // Find best match within refinement window
        let bestMatch = {
          timestamp: coarseMatch.targetTimestamp,
          distance: coarseMatch.hammingDistance,
          similarity: coarseMatch.similarity,
        };

        // Check all refinement frames near this timestamp
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

        // Convert timestamp to frame number for Frame.io API
        const targetFrameNumber = Math.round(bestMatch.timestamp * targetMetadata.fps);
        
        finalMatches.push({
          sourceComment: coarseMatch.sourceComment,
          targetFrameNumber,
          targetTimestamp: bestMatch.timestamp,
          hammingDistance: bestMatch.distance,
          similarity: bestMatch.similarity,
        });

        console.log(`  Comment "${coarseMatch.sourceComment.text?.substring(0, 30)}..."`);
        console.log(`    Source: frame ${coarseMatch.sourceComment.timestamp}`);
        console.log(`    Coarse: ${coarseMatch.targetTimestamp.toFixed(2)}s (similarity: ${(coarseMatch.similarity * 100).toFixed(1)}%)`);
        console.log(`    Refined: ${bestMatch.timestamp.toFixed(2)}s → frame ${targetFrameNumber} (similarity: ${(bestMatch.similarity * 100).toFixed(1)}%)`);
      }

      await this.updateJobProgress(jobId, 'processing', 0.9, `Matched ${finalMatches.length} comments`);
      
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
        updatedAt: new Date(),
      })
      .where(eq(processingJobs.id, jobId));

    console.log(`[${(progress * 100).toFixed(0)}%] ${message}`);
  }
}