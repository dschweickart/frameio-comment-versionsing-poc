import { NextResponse } from 'next/server';
import { db, userTokens } from '@/lib/db';
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

    // Get the user's account ID from their stored tokens
    const userToken = await db.query.userTokens.findFirst({
      where: eq(userTokens.userId, session.user.id),
    });

    if (!userToken?.accountId) {
      return NextResponse.json(
        { error: 'Account ID not found' },
        { status: 400 }
      );
    }
    
    const accountId = userToken.accountId;

    // Fetch jobs for this account, ordered by most recent first
    const jobs = await db.query.processingJobs.findMany({
      where: eq(processingJobs.accountId, accountId),
      orderBy: [desc(processingJobs.createdAt)],
      limit: 50, // Last 50 jobs
    });

    // Parse metadata for each job
    const jobsWithMetadata = jobs.map(job => {
      const metadata = job.metadata 
        ? (typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata)
        : {};
      
      return {
        id: job.id,
        status: job.status,
        progress: job.progress,
        message: job.message,
        sourceFileName: metadata.sourceFileName || 'Unknown',
        targetFileName: metadata.targetFileName || 'Unknown',
        commentsCount: metadata.sourceCommentsCount || 0,
        matchesFound: metadata.matchesFound || 0,
        commentsTransferred: metadata.commentsTransferred || 0,
        createdAt: job.createdAt,
        completedAt: metadata.completedAt || null,
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

