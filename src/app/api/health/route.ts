import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export async function GET() {
  try {
    // Test database connection
    const result = await db.execute(sql`SELECT version()`);
    const version = result[0]?.version?.substring(0, 50) + '...';
    
    // Test pgvector extension
    const vectorResult = await db.execute(sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    const hasPgVector = vectorResult.length > 0;
    
    // Check tables
    const tables = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('videos', 'frames', 'comments', 'processing_jobs')
      ORDER BY table_name
    `);
    
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        version,
        pgvector: hasPgVector,
        tables: tables.map(t => t.table_name),
        tablesCount: tables.length
      }
    });
    
  } catch (error) {
    console.error('Health check failed:', error);
    
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
      database: {
        connected: false
      }
    }, { status: 500 });
  }
}
