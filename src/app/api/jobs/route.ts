import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processingJobs } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getSession } from '@/lib/auth/crypto';

export async function GET() {
  try {
    // Get authenticated user from session
    const session = await getSession();
    
    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Fetch jobs for this user (not by account, since users can belong to multiple accounts)
    const jobs = await db.query.processingJobs.findMany({
      where: eq(processingJobs.userId, session.user.id),
      orderBy: [desc(processingJobs.createdAt)],
      limit: 50, // Last 50 jobs
    });

    // Parse metadata and combine with database columns
    const jobsWithMetadata = jobs.map(job => {
      const metadata = job.metadata 
        ? (typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata)
        : {};
      
      // Calculate duration for completed jobs
      let duration = null;
      if (job.completedAt && job.createdAt) {
        const durationMs = new Date(job.completedAt).getTime() - new Date(job.createdAt).getTime();
        const minutes = Math.floor(durationMs / 60000);
        const seconds = Math.floor((durationMs % 60000) / 1000);
        duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      }
      
      return {
        id: job.id,
        status: job.status || 'pending',
        progress: job.progress ? parseFloat(job.progress) : 0,
        progressPercent: job.progress ? Math.round(parseFloat(job.progress) * 100) : 0,
        message: job.message,
        errorMessage: job.errorMessage,
        // File names from metadata (not stored in DB columns)
        sourceFileName: metadata.sourceFileName || 'Unknown',
        targetFileName: metadata.targetFileName || 'Unknown',
        commentsCount: metadata.sourceCommentsCount || 0,
        // Database columns (not metadata)
        matchesFound: job.matchesFound || 0,
        commentsTransferred: job.commentsTransferred || 0,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        duration,
        // Additional info
        accountId: job.accountId,
        projectId: job.projectId,
      };
    });

    return NextResponse.json({ jobs: jobsWithMetadata });

  } catch (error) {
    console.error('Failed to fetch jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

