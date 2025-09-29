#!/usr/bin/env node

/**
 * Database setup script for Vercel deployment
 * This script runs after Vercel creates the Neon database
 * and sets up the required schema and extensions
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL or POSTGRES_URL environment variable is required');
    process.exit(1);
  }

  console.log('🚀 Setting up database schema...');
  
  try {
    const sql = neon(databaseUrl);
    
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, '../src/lib/db/migrations/001_initial_setup.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split the migration into individual statements
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📋 Executing ${statements.length} SQL statements...`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          await sql`${statement}`;
          console.log(`✅ Statement ${i + 1}/${statements.length} completed`);
        } catch (error) {
          // Some statements might fail if already executed - that's ok
          if (!error.message.includes('already exists')) {
            console.warn(`⚠️  Statement ${i + 1} warning:`, error.message);
          }
        }
      }
    }
    
    // Verify setup
    console.log('🔍 Verifying database setup...');
    
    // Check pgvector extension
    const vectorCheck = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    if (vectorCheck.length > 0) {
      console.log('✅ pgvector extension is enabled');
    } else {
      console.log('❌ pgvector extension not found');
    }
    
    // Check tables
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('videos', 'frames', 'comments', 'processing_jobs')
      ORDER BY table_name
    `;
    
    console.log('📋 Tables created:', tables.map(t => t.table_name).join(', '));
    
    if (tables.length === 4) {
      console.log('🎉 Database setup completed successfully!');
    } else {
      console.log('❌ Some tables are missing');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    process.exit(1);
  }
}

// Run setup if this file is executed directly
if (require.main === module) {
  setupDatabase();
}

module.exports = { setupDatabase };
