# Database Setup Guide - Frame.io Comment Versioning POC

This guide will help you set up the Neon PostgreSQL database with pgvector extension for the Frame.io Comment Versioning POC.

## Prerequisites

1. **Neon Account**: Sign up at [neon.tech](https://neon.tech)
2. **Project**: Create a new Neon project
3. **Node.js**: Ensure you have Node.js 18+ installed

## Step 1: Create Neon Database

1. Go to [Neon Console](https://console.neon.tech)
2. Create a new project called "frameio-comment-versioning"
3. Note down your connection string from the dashboard

## Step 2: Enable pgvector Extension

1. In your Neon dashboard, go to the SQL Editor
2. Run the following command to enable the pgvector extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Step 3: Set Up Environment Variables

1. Copy the example environment file:
```bash
cp .env.example .env.local
```

2. Update the `DATABASE_URL` in `.env.local` with your Neon connection string:
```bash
DATABASE_URL=postgresql://username:password@hostname/database?sslmode=require
```

## Step 4: Run Database Migrations

Execute the SQL migration file in your Neon SQL Editor:

1. Open the file `src/lib/db/migrations/001_initial_setup.sql`
2. Copy the entire contents
3. Paste and execute in Neon SQL Editor

This will create:
- `videos` table - stores Frame.io video metadata
- `frames` table - stores extracted frames with vector embeddings
- `comments` table - stores Frame.io comments and transferred comments
- `processing_jobs` table - tracks comment transfer operations
- All necessary indexes including vector similarity indexes

## Step 5: Verify Setup

You can verify your database setup by running:

```bash
npm run db:studio
```

This will open Drizzle Studio where you can inspect your database schema.

## Database Schema Overview

### Tables

1. **videos**: Stores Frame.io video file metadata
   - `frameio_id`: Unique Frame.io file identifier
   - `filename`: Original video filename
   - `duration_seconds`: Video duration
   - `frame_count`: Total number of frames

2. **frames**: Stores extracted video frames with embeddings
   - `video_id`: References videos table
   - `timestamp_seconds`: Frame timestamp in video
   - `embedding`: 1536-dimensional vector (OpenAI embeddings)
   - Vector similarity index for fast nearest neighbor search

3. **comments**: Stores Frame.io comments and transferred comments
   - `frameio_comment_id`: Original Frame.io comment ID
   - `video_id`: References videos table
   - `timestamp_seconds`: Comment timestamp
   - `original_timestamp`: For transferred comments
   - `confidence_score`: AI matching confidence (0.0-1.0)

4. **processing_jobs**: Tracks comment transfer operations
   - `source_video_id`: Source video with comments
   - `target_video_id`: Target video to receive comments
   - `status`: Job status (pending, processing, completed, failed)
   - `progress`: Job completion percentage

### Vector Similarity Search

The database is optimized for vector similarity search using:
- **IVFFlat index**: Approximate nearest neighbor search for large datasets
- **Cosine similarity**: Distance metric for comparing embeddings
- **Configurable dimensions**: Currently set to 1536 for OpenAI embeddings

## Performance Considerations

1. **Index Configuration**: The IVFFlat index is configured with `lists = 100`
   - Increase for larger datasets (>1M vectors)
   - Decrease for smaller datasets (<100K vectors)

2. **Alternative HNSW Index**: For better accuracy with higher memory usage:
```sql
CREATE INDEX idx_frames_embedding_hnsw ON frames 
USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```

3. **Connection Pooling**: Neon automatically handles connection pooling

## Troubleshooting

### Common Issues

1. **pgvector extension not found**:
   - Ensure you've enabled the extension in Neon console
   - Some Neon plans may not support extensions

2. **Vector dimension mismatch**:
   - Verify your embedding model outputs 1536 dimensions
   - Update schema if using different embedding model

3. **Index creation timeout**:
   - IVFFlat index creation can be slow with large datasets
   - Consider creating index after data insertion

### Monitoring

Use these queries to monitor your database:

```sql
-- Check table sizes
SELECT schemaname,tablename,attname,n_distinct,correlation 
FROM pg_stats WHERE tablename IN ('videos','frames','comments','processing_jobs');

-- Check index usage
SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch 
FROM pg_stat_user_indexes WHERE schemaname = 'public';

-- Check vector index statistics
SELECT * FROM pg_stat_user_indexes WHERE indexrelname LIKE '%embedding%';
```

## Next Steps

After completing the database setup:

1. Set up Frame.io API credentials in `.env.local`
2. Configure OpenAI API key for embeddings
3. Test the connection by running the development server:
   ```bash
   npm run dev
   ```

For development, you can use Drizzle Studio to inspect and modify your data:
```bash
npm run db:studio
```
