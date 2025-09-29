import { db } from './index';
import { sql } from 'drizzle-orm';

/**
 * Test database connection and pgvector extension
 * Run with: npx tsx src/lib/db/test-connection.ts
 */
export async function testDatabaseConnection() {
  try {
    console.log('Testing database connection...');
    
    // Test basic connection
    const result = await db.execute(sql`SELECT version()`);
    console.log('✅ Database connected successfully');
    console.log('PostgreSQL version:', result[0]?.version?.substring(0, 50) + '...');
    
    // Test pgvector extension
    const vectorResult = await db.execute(sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    if (vectorResult.length > 0) {
      console.log('✅ pgvector extension is enabled');
    } else {
      console.log('❌ pgvector extension not found');
    }
    
    // Test vector operations
    const vectorTest = await db.execute(sql`SELECT '[1,2,3]'::vector(3) <-> '[4,5,6]'::vector(3) as distance`);
    console.log('✅ Vector operations working, test distance:', vectorTest[0]?.distance);
    
    // Test tables exist
    const tables = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('videos', 'frames', 'comments', 'processing_jobs')
      ORDER BY table_name
    `);
    
    console.log('📋 Tables found:', tables.map(t => t.table_name).join(', '));
    
    if (tables.length === 4) {
      console.log('✅ All required tables are present');
    } else {
      console.log('❌ Missing tables. Please run the migration SQL.');
    }
    
    console.log('\n🎉 Database setup verification complete!');
    
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testDatabaseConnection();
}
