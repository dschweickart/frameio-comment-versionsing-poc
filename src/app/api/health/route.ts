import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function GET() {
  try {
    // Get database URL - Next.js should load .env.local automatically
    const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    
    if (!databaseUrl) {
      return NextResponse.json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'No database URL found in environment variables',
        database: {
          connected: false
        }
      }, { status: 500 });
    }

    // Create direct connection for health check
    const sql = neon(databaseUrl);
    
    // Test database connection
    console.log('Testing database connection...');
    const versionResult = await sql`SELECT version()`;
    const version = versionResult[0]?.version?.substring(0, 50) + '...';
    console.log('Version check passed');
    
    // Test pgvector extension
    console.log('Testing pgvector extension...');
    const vectorResult = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    const hasPgVector = vectorResult.length > 0;
    console.log('pgvector check:', hasPgVector);
    
    // Check tables
    console.log('Checking tables...');
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('videos', 'frames', 'comments', 'processing_jobs')
      ORDER BY table_name
    `;
    console.log('Tables found:', tables);
    
    // Test vector operation if pgvector is available
    let vectorTest = null;
    if (hasPgVector) {
      try {
        const vectorTestResult = await sql`SELECT '[1,2,3]'::vector(3) <-> '[4,5,6]'::vector(3) as distance`;
        vectorTest = vectorTestResult[0]?.distance;
      } catch (error) {
        console.warn('Vector test failed:', error);
      }
    }
    
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        version,
        pgvector: hasPgVector,
        vectorTest,
        tables: tables.map(t => t.table_name),
        tablesCount: tables.length
      },
      environment: {
        hasDbUrl: !!databaseUrl,
        nodeEnv: process.env.NODE_ENV
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
