import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create Neon HTTP connection
const sql = neon(process.env.DATABASE_URL);

// Initialize Drizzle ORM with schema
export const db = drizzle(sql, { schema });

// Export schema for use in other files
export * from './schema';
