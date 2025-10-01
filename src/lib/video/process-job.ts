import { db, processingJobs } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { FrameioClient } from '@/lib/frameio-client';
import { FrameProcessor } from './frame-processor';
import { CommentTransfer } from './comment-transfer';

export interface JobResult {
  success: boolean;
  message: string;
  transferred: number;
  skipped: number;
  failed: number;
}

/**
 * Process a comment transfer job from start to finish
 * 
 * Workflow:
 * 1. Load job from database
 * 2. Create Frame.io client from stored tokens
 * 3. Process videos using FrameProcessor (extract frames, generate hashes, match)
 * 4. Transfer matched comments using CommentTransfer
 * 5. Update job status with results
 */
export async function processJob(jobId: string): Promise<JobResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 STARTING JOB PROCESSING: ${jobId}`);
  console.log(`${'='.repeat(80)}\n`);

  try {
    // Step 1: Load job from database
    const job = await db.query.processingJobs.findFirst({
      where: eq(processingJobs.id, jobId),
    });

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    console.log(`📋 Job Details:`);
    console.log(`   Account: ${job.accountId}`);
    console.log(`   Source File: ${job.sourceFileId}`);
    console.log(`   Target File: ${job.targetFileId}`);
    console.log(`   User: ${job.userName} (${job.userEmail})`);

    const metadata = job.metadata 
      ? (typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata)
      : {};
    console.log(`   Source Comments: ${metadata.sourceCommentsCount || 0}`);
    console.log('');

    // Step 2: Create Frame.io client
    await updateJob(jobId, 'processing', 0.05, 'Authenticating with Frame.io...');
    const client = await FrameioClient.fromAccountId(job.accountId!);
    
    if (!client) {
      throw new Error('Failed to create Frame.io client - user not authenticated');
    }

    console.log('✅ Frame.io client authenticated\n');

    // Step 3: Process videos (extract frames, generate hashes, match comments)
    const processor = new FrameProcessor(client);
    const matches = await processor.processVideos({
      accountId: job.accountId!,
      sourceFileId: job.sourceFileId!,
      targetFileId: job.targetFileId!,
      jobId,
    });

    console.log(`\n✅ Frame processing complete: ${matches.length} matches found\n`);

    // Step 4: Transfer comments
    await updateJob(jobId, 'processing', 0.95, `Transferring ${matches.length} comments...`);
    const transferService = new CommentTransfer(client);
    
    // Parse sensitivity from metadata (high/medium/low)
    const sensitivity = (metadata.sensitivity as 'high' | 'medium' | 'low') || 'medium';
    const sensitivityMap: Record<'high' | 'medium' | 'low', number> = {
      high: 0.85,   // 85% similarity (5-10 bits different)
      medium: 0.70, // 70% similarity (15-20 bits different)
      low: 0.55,    // 55% similarity (25-30 bits different)
    };
    const minSimilarity = sensitivityMap[sensitivity] || 0.70;

    console.log(`🎯 Similarity threshold: ${(minSimilarity * 100).toFixed(0)}% (${sensitivity} sensitivity)`);

    const transferResult = await transferService.transferComments(
      job.accountId!,
      job.targetFileId!,
      matches,
      { minSimilarity }
    );

    // Step 5: Update job with results
    const finalMessage = transferResult.success
      ? `✅ Transferred ${transferResult.transferred} of ${matches.length} comments successfully`
      : `⚠️ Transferred ${transferResult.transferred}, failed ${transferResult.failed}, skipped ${transferResult.skipped}`;

    await updateJob(
      jobId,
      transferResult.success ? 'completed' : 'completed_with_errors',
      1.0,
      finalMessage,
      {
        matchesFound: matches.length,
        commentsTransferred: transferResult.transferred,
        completedAt: new Date(),
      }
    );

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ JOB COMPLETED: ${jobId}`);
    console.log(`${'='.repeat(80)}\n`);

    return {
      success: transferResult.success,
      message: finalMessage,
      transferred: transferResult.transferred,
      skipped: transferResult.skipped,
      failed: transferResult.failed,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ JOB FAILED: ${errorMessage}\n`);
    console.error(error);

    await updateJob(
      jobId,
      'failed',
      1.0,
      `Error: ${errorMessage}`,
      {
        errorMessage,
      }
    );

    return {
      success: false,
      message: `Job failed: ${errorMessage}`,
      transferred: 0,
      skipped: 0,
      failed: 0,
    };
  }
}

/**
 * Update job progress in database
 */
async function updateJob(
  jobId: string,
  status: string,
  progress: number,
  message: string,
  additionalFields: Record<string, unknown> = {}
): Promise<void> {
  await db.update(processingJobs)
    .set({
      status,
      progress: progress.toFixed(2),
      message,
      ...additionalFields,
    })
    .where(eq(processingJobs.id, jobId));

  console.log(`[${(progress * 100).toFixed(0)}%] ${message}`);
}
