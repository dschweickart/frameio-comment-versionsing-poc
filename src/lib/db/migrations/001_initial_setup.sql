-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create videos table
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frameio_id VARCHAR(255) UNIQUE NOT NULL,
  filename VARCHAR(255) NOT NULL,
  duration_seconds INTEGER,
  frame_count INTEGER,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create frames table with vector embedding column
CREATE TABLE IF NOT EXISTS frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  timestamp_seconds DECIMAL(10,3) NOT NULL,
  frame_number INTEGER NOT NULL,
  embedding vector(1536), -- 1536 dimensions for OpenAI text-embedding-3-small
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create comments table
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frameio_comment_id VARCHAR(255) UNIQUE NOT NULL,
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  timestamp_seconds DECIMAL(10,3) NOT NULL,
  text TEXT NOT NULL,
  author VARCHAR(255),
  original_timestamp DECIMAL(10,3), -- For transferred comments
  confidence_score DECIMAL(3,2), -- Match confidence (0.0 to 1.0)
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create processing_jobs table
CREATE TABLE IF NOT EXISTS processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  target_video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending',
  progress DECIMAL(3,2) DEFAULT 0,
  message TEXT,
  matches_found INTEGER DEFAULT 0,
  comments_transferred INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Create indexes for performance

-- Index on frameio_id for quick lookups
CREATE INDEX IF NOT EXISTS idx_videos_frameio_id ON videos(frameio_id);

-- Index on video_id for frame queries
CREATE INDEX IF NOT EXISTS idx_frames_video_id ON frames(video_id);

-- Index on timestamp for temporal queries
CREATE INDEX IF NOT EXISTS idx_frames_timestamp ON frames(timestamp_seconds);

-- Vector similarity index using IVFFlat (good for large datasets)
-- This creates an approximate nearest neighbor index
CREATE INDEX IF NOT EXISTS idx_frames_embedding ON frames 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Alternative: Use HNSW index for better accuracy (requires more memory)
-- CREATE INDEX IF NOT EXISTS idx_frames_embedding_hnsw ON frames 
-- USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Index on video_id for comment queries
CREATE INDEX IF NOT EXISTS idx_comments_video_id ON comments(video_id);

-- Index on frameio_comment_id for quick lookups
CREATE INDEX IF NOT EXISTS idx_comments_frameio_id ON comments(frameio_comment_id);

-- Index on timestamp for temporal queries
CREATE INDEX IF NOT EXISTS idx_comments_timestamp ON comments(timestamp_seconds);

-- Indexes for processing jobs
CREATE INDEX IF NOT EXISTS idx_processing_jobs_source_video ON processing_jobs(source_video_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_target_video ON processing_jobs(target_video_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created_at ON processing_jobs(created_at);

-- Add updated_at trigger for videos table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_videos_updated_at 
    BEFORE UPDATE ON videos 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
