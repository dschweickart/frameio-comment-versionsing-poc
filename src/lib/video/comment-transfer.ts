import { FrameioClient, FrameioComment } from '@/lib/frameio-client';
import { CommentMatch } from './frame-processor';

export interface TransferResult {
  success: boolean;
  transferred: number;
  failed: number;
  skipped: number;
  details: TransferDetail[];
}

export interface TransferDetail {
  sourceComment: FrameioComment;
  targetTimestamp?: number;
  transferred: boolean;
  reason?: string;
  similarity?: number;
  newCommentId?: string;
}

export interface TransferOptions {
  minSimilarity?: number; // Minimum similarity threshold (default: 0.7 = 70%)
  transferAnnotations?: boolean; // Whether to transfer drawing annotations
  addPrefix?: boolean; // Add "[Transferred]" prefix to comments
}

/**
 * Transfer comments from matched source frames to target video
 */
export class CommentTransfer {
  private client: FrameioClient;
  
  constructor(client: FrameioClient) {
    this.client = client;
  }

  /**
   * Transfer matched comments to target file in batches to respect rate limits
   * Frame.io rate limit: 10 calls per minute
   */
  async transferComments(
    accountId: string,
    targetFileId: string,
    matches: CommentMatch[],
    options: TransferOptions = {}
  ): Promise<TransferResult> {
    const {
      minSimilarity = 0.8, // 80% similarity threshold (skip low confidence < 80%)
      // transferAnnotations = true, // TODO: Implement annotation transfer
      addPrefix = true,
    } = options;

    const BATCH_SIZE = 10; // Frame.io rate limit: 10 calls per minute
    const RATE_LIMIT_DELAY_MS = 60000; // Wait 60 seconds between batches
    const totalBatches = Math.ceil(matches.length / BATCH_SIZE);

    console.log(`\n🚀 Comment Transfer: ${matches.length} comments, ${totalBatches} batches, ~${totalBatches} min\n`);

    const details: TransferDetail[] = [];
    let transferred = 0;
    let failed = 0;
    let skipped = 0;

    // Process in batches of 10
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, matches.length);
      const batch = matches.slice(batchStart, batchEnd);

      console.log(`\n📦 Batch ${batchIndex + 1}/${totalBatches}: Processing ${batch.length} comments (${batchStart + 1}-${batchEnd})...`);

      for (const match of batch) {
      const { sourceComment, targetTimestamp, similarity, confidence } = match;

      // Check similarity threshold
      if (similarity < minSimilarity) {
        console.log(
          `⏭️  Skipping comment (low similarity): ` +
          `"${sourceComment.text?.substring(0, 50)}..." ` +
          `(${(similarity * 100).toFixed(1)}% < ${(minSimilarity * 100).toFixed(0)}%)`
        );
        
        details.push({
          sourceComment,
          transferred: false,
          reason: `Low similarity (${(similarity * 100).toFixed(1)}%)`,
          similarity,
        });
        skipped++;
        continue;
      }

      // Prepare comment text with confidence indicator
      const confidenceEmoji = {
        high: '✓',
        medium: '~',
        low: '?'
      }[confidence || 'medium'];
      
      // FIXED: Use actual comment text instead of placeholder frame number
      let commentText = sourceComment.text || 'No comment text';
      if (addPrefix) {
        commentText = `[Transferred ${confidenceEmoji}] ${commentText}`;
      }

      // Use the targetFrameNumber from the match (already calculated with correct FPS)
      const matchedFrameNumber = match.targetFrameNumber;
      
      // WORKAROUND: Frame.io bug - comments display 1 frame early (n-1)
      // When we send frame N, Frame.io displays it at frame N-1
      // Therefore, send N+1 to display at the correct frame N
      // Example: We want frame 336 → send 337 → Frame.io displays at 336
      const frameNumber = matchedFrameNumber + 1;

      try {
        console.log(
          `📝 Transferring: "${commentText.substring(0, 40)}..." @ frame ${matchedFrameNumber} ` +
          `(${(similarity * 100).toFixed(1)}% ${confidence}) → API sends ${frameNumber} (Frame.io n-1 bug fix)`
        );

        const commentData = {
          text: commentText,
          timestamp: frameNumber,
          // TODO: Transfer annotation data if present and transferAnnotations is true
          // annotation: transferAnnotations && sourceComment.annotation ? sourceComment.annotation : undefined,
        };

        // Create comment on target file
        const newComment = await this.client.createComment(
          accountId,
          targetFileId,
          commentData
        );

        details.push({
          sourceComment,
          targetTimestamp,
          transferred: true,
          similarity,
          newCommentId: newComment.id,
        });
        transferred++;

      } catch (error) {
        console.error(
          `❌ Failed to transfer comment: ${error instanceof Error ? error.message : String(error)}`
        );

        details.push({
          sourceComment,
          targetTimestamp,
          transferred: false,
          reason: `API error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          similarity,
        });
        failed++;
      }
    }

      // End of batch summary
      console.log(`   Batch ${batchIndex + 1}/${totalBatches}: ✅ ${transferred} | ⏭️  ${skipped} | ❌ ${failed}`);

      // Wait 60 seconds before next batch (respect Frame.io rate limit)
      if (batchIndex < totalBatches - 1) {
        console.log(`   ⏳ Rate limit cooldown: ${RATE_LIMIT_DELAY_MS / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }
    }

    console.log(`\n📊 Transfer Complete: ✅ ${transferred} | ⏭️  ${skipped} | ❌ ${failed}\n`);

    return {
      success: failed === 0,
      transferred,
      failed,
      skipped,
      details,
    };
  }
}
