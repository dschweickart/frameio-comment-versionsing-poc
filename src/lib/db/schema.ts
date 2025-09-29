import { pgTable, uuid, varchar, integer, decimal, text, timestamp, vector } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Videos table - stores Frame.io video metadata
export const videos = pgTable('videos', {
  id: uuid('id').primaryKey().defaultRandom(),
  frameioId: varchar('frameio_id', { length: 255 }).unique().notNull(),
  filename: varchar('filename', { length: 255 }).notNull(),
  durationSeconds: integer('duration_seconds'),
  frameCount: integer('frame_count'),
  processedAt: timestamp('processed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Frames table - stores extracted video frames with embeddings
export const frames = pgTable('frames', {
  id: uuid('id').primaryKey().defaultRandom(),
  videoId: uuid('video_id').references(() => videos.id).notNull(),
  timestampSeconds: decimal('timestamp_seconds', { precision: 10, scale: 3 }).notNull(),
  frameNumber: integer('frame_number').notNull(),
  // Vector embedding - adjust dimension based on model (1536 for OpenAI text-embedding-3-small)
  embedding: vector('embedding', { dimensions: 1536 }),
  createdAt: timestamp('created_at').defaultNow(),
});

// Comments table - stores Frame.io comments and transferred comments
export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  frameioCommentId: varchar('frameio_comment_id', { length: 255 }).unique().notNull(),
  videoId: uuid('video_id').references(() => videos.id).notNull(),
  timestampSeconds: decimal('timestamp_seconds', { precision: 10, scale: 3 }).notNull(),
  text: text('text').notNull(),
  author: varchar('author', { length: 255 }),
  // For transferred comments - track original timestamp
  originalTimestamp: decimal('original_timestamp', { precision: 10, scale: 3 }),
  // AI match confidence score (0.0 to 1.0)
  confidenceScore: decimal('confidence_score', { precision: 3, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow(),
});

// Processing jobs table - tracks comment transfer operations
export const processingJobs = pgTable('processing_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceVideoId: uuid('source_video_id').references(() => videos.id).notNull(),
  targetVideoId: uuid('target_video_id').references(() => videos.id).notNull(),
  status: varchar('status', { length: 50 }).default('pending'),
  progress: decimal('progress', { precision: 3, scale: 2 }).default('0'),
  message: text('message'),
  matchesFound: integer('matches_found').default(0),
  commentsTransferred: integer('comments_transferred').default(0),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow(),
  completedAt: timestamp('completed_at'),
});

// User tokens table - stores OAuth tokens for server-side access
export const userTokens = pgTable('user_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: varchar('user_id', { length: 255 }).unique().notNull(), // Frame.io user ID
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  accountId: varchar('account_id', { length: 255 }),
  email: varchar('email', { length: 255 }),
  name: varchar('name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Define relations between tables
export const videosRelations = relations(videos, ({ many }) => ({
  frames: many(frames),
  comments: many(comments),
  sourceProcessingJobs: many(processingJobs, { relationName: 'sourceVideo' }),
  targetProcessingJobs: many(processingJobs, { relationName: 'targetVideo' }),
}));

export const framesRelations = relations(frames, ({ one }) => ({
  video: one(videos, {
    fields: [frames.videoId],
    references: [videos.id],
  }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  video: one(videos, {
    fields: [comments.videoId],
    references: [videos.id],
  }),
}));

export const processingJobsRelations = relations(processingJobs, ({ one }) => ({
  sourceVideo: one(videos, {
    fields: [processingJobs.sourceVideoId],
    references: [videos.id],
    relationName: 'sourceVideo',
  }),
  targetVideo: one(videos, {
    fields: [processingJobs.targetVideoId],
    references: [videos.id],
    relationName: 'targetVideo',
  }),
}));

// Export types for TypeScript
export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;

export type Frame = typeof frames.$inferSelect;
export type NewFrame = typeof frames.$inferInsert;

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

export type ProcessingJob = typeof processingJobs.$inferSelect;
export type NewProcessingJob = typeof processingJobs.$inferInsert;

export type UserToken = typeof userTokens.$inferSelect;
export type NewUserToken = typeof userTokens.$inferInsert;
