-- Migration 003: Add Frame.io specific fields to processing_jobs

ALTER TABLE processing_jobs
ADD COLUMN IF NOT EXISTS account_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS project_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS version_stack_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS source_file_id VARCHAR(255), -- Frame.io file ID
ADD COLUMN IF NOT EXISTS target_file_id VARCHAR(255), -- Frame.io file ID
ADD COLUMN IF NOT EXISTS interaction_id VARCHAR(255), -- Custom action interaction ID
ADD COLUMN IF NOT EXISTS user_id VARCHAR(255), -- Frame.io user who triggered
ADD COLUMN IF NOT EXISTS user_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS user_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS metadata JSONB; -- Store additional webhook data

-- Create indexes for Frame.io lookups
CREATE INDEX IF NOT EXISTS idx_processing_jobs_account_id ON processing_jobs (account_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_interaction_id ON processing_jobs (interaction_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs (status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created_at ON processing_jobs (created_at DESC);

-- Add comment
COMMENT ON COLUMN processing_jobs.metadata IS 'Stores additional webhook data and processing parameters (e.g., sensitivity, preview_mode, notes)';
