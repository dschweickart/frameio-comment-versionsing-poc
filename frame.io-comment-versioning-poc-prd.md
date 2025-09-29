# Frame.io Comment Versioning POC - Product Requirements Document

## Executive Summary

The Frame.io Comment Versioning POC is an intelligent video collaboration tool that automatically transfers comments between different versions of video files using AI-powered visual similarity matching. The system leverages multi-modal AI embeddings to match video frames and accurately transfer contextual feedback across video iterations.

## Project Overview

### Problem Statement
Video production workflows often involve multiple versions of the same content (rough cuts, fine cuts, final versions). When comments are made on earlier versions, they become disconnected from later iterations, forcing reviewers to manually re-add feedback and breaking collaboration continuity.

### Solution
An intelligent comment versioning system that:
1. Analyzes visual content of source and target videos
2. Uses AI embeddings to match similar frames across video versions
3. Automatically transfers comments to corresponding timestamps in new video versions
4. Maintains review context and collaboration history

### Success Metrics
- **Accuracy**: >85% correct comment placement on target videos
- **Performance**: Process videos up to 10 minutes in <5 minutes
- **User Experience**: Seamless integration with Frame.io workflow
- **Reliability**: 99.9% uptime for webhook processing

## Technical Architecture

### Platform Stack
- **Frontend/Backend**: Next.js 14 (App Router)
- **Hosting**: Vercel (with Edge Functions for webhooks)
- **Database**: Neon PostgreSQL with pgvector extension
- **AI/ML**: Vercel AI SDK with multi-modal embeddings
- **Vector Search**: FAISS for fine-grained similarity matching
- **Video Processing**: FFmpeg for frame extraction
- **Integration**: Frame.io v4 API

### System Components

#### 1. Frame.io Integration Layer
- **Custom Actions**: Programmatically configured webhook endpoints
- **API Client**: Frame.io v4 API wrapper for resource management
- **Webhook Handler**: Secure webhook processing with signature verification
- **OAuth Flow**: Client credentials flow for API authentication

#### 2. Video Processing Engine
- **Proxy Download**: Temporary video file retrieval from Frame.io
- **Frame Extraction**: FFmpeg-based timestamp-specific frame capture
- **Batch Processing**: Efficient handling of multiple video files
- **Cleanup**: Automatic temporary file management

#### 3. AI Embedding System
- **Multi-modal Embeddings**: Visual content analysis using Vercel AI SDK
- **Batch Processing**: Efficient embedding generation for video frames
- **Vector Storage**: Neon PostgreSQL with pgvector for similarity search
- **Similarity Matching**: Configurable threshold-based matching

#### 4. Fine-grained Matching
- **FAISS Integration**: Local vector search for precise frame matching
- **Context Window**: 24-frame before/after analysis for accuracy
- **Confidence Scoring**: Match quality assessment
- **Fallback Logic**: Multiple matching strategies

#### 5. Comment Transfer System
- **Comment Extraction**: Source video comment retrieval
- **Timestamp Mapping**: Frame-to-timestamp conversion
- **Comment Creation**: Automated comment posting to target videos
- **Metadata Preservation**: Original context and authorship tracking

## Detailed Requirements

### Functional Requirements

#### FR1: Frame.io Integration
- **FR1.1**: Support Frame.io v4 API authentication (client credentials)
- **FR1.2**: Receive and process custom action webhooks
- **FR1.3**: Programmatically configure custom actions on deployment
- **FR1.4**: Retrieve comments, video files, and metadata via API
- **FR1.5**: Create new comments with preserved metadata

#### FR2: Video Processing
- **FR2.1**: Download video proxy files temporarily (max 500MB) using media_links.video_h264_720
- **FR2.2**: Extract frames at comment timestamps (source video)
- **FR2.3**: Extract frames at regular intervals (target video, default 1/24fps)
- **FR2.4**: Support AVC encoded MP4 files (Frame.io proxies are consistent format)
- **FR2.5**: Automatic cleanup of temporary files

#### FR3: AI Embedding & Matching
- **FR3.1**: Generate multi-modal embeddings for extracted frames
- **FR3.2**: Store embeddings in vector database with metadata
- **FR3.3**: Perform similarity search with configurable thresholds
- **FR3.4**: Fine-grained matching using FAISS to return single highest confidence match only
- **FR3.5**: Return confidence scores for all matches

#### FR4: Comment Transfer
- **FR4.1**: Map source comment timestamps to target video timestamps (some comments may not have matches or have low confidence - this is normal)
- **FR4.2**: Transfer comment text with original authorship attribution
- **FR4.3**: Fully automated comment transfer with no user involvement required
- **FR4.4**: Preserve comment metadata (author, timestamp, frame)
- **FR4.5**: Process comments individually to respect Frame.io rate limits (no batch commenting API available)

#### FR5: Configuration & Management
- **FR5.1**: Configurable similarity thresholds (default: 0.8)
- **FR5.2**: Configurable frame extraction rates (default: 1/24fps)
- **FR5.3**: Vercel UI with basic Frame.io login functionality for authentication
- **FR5.4**: Deployment-time custom action registration
- **FR5.5**: Processing status tracking and logging

### Non-Functional Requirements

#### NFR1: Performance
- **NFR1.1**: Process videos up to 10 minutes in <2 minutes (frame extraction should be <1 second per frame)
- **NFR1.2**: Handle concurrent webhook requests (up to 10 simultaneous)
- **NFR1.3**: Embedding generation <30 seconds per minute of video
- **NFR1.4**: Vector search results in <2 seconds

#### NFR2: Scalability
- **NFR2.1**: Support up to 100 concurrent users
- **NFR2.2**: Handle video files up to 500MB
- **NFR2.3**: Store up to 10,000 video embeddings
- **NFR2.4**: Process up to 1,000 comments per video

#### NFR3: Reliability
- **NFR3.1**: 99.9% uptime for webhook processing
- **NFR3.2**: Automatic retry for failed Frame.io API calls
- **NFR3.3**: Graceful handling of unsupported video formats
- **NFR3.4**: Error logging and monitoring

#### NFR4: Security
- **NFR4.1**: Webhook signature verification
- **NFR4.2**: Secure Frame.io API credential management
- **NFR4.3**: Temporary file encryption at rest
- **NFR4.4**: Rate limiting for API endpoints

## User Experience Flow

### Primary Workflow
1. **User Action**: User selects source and target videos in Frame.io
2. **Custom Action**: User triggers "Transfer Comments" custom action
3. **Webhook Processing**: System receives webhook with video IDs
4. **Video Analysis**: System downloads and processes both videos
5. **AI Matching**: System generates embeddings and finds matches
6. **Comment Transfer**: System creates new comments on target video
7. **User Notification**: User receives completion notification in Frame.io

### Edge Cases
- **No Matches Found**: Notify user with suggested manual review
- **Multiple Matches**: Present options for user selection
- **Processing Errors**: Provide clear error messages and retry options
- **Large Files**: Show processing progress and estimated completion time

## API Specifications

### Webhook Endpoints

#### POST /api/webhooks/frameio
Receives Frame.io custom action webhooks
```json
{
  "event": "custom_action.triggered",
  "payload": {
    "action_id": "comment_versioning",
    "source_video_id": "file_123",
    "target_video_id": "file_456",
    "workspace_id": "workspace_789",
    "user_id": "user_101"
  }
}
```

#### GET /api/status/[processId]
Returns processing status for comment transfer job
```json
{
  "status": "processing|completed|failed",
  "progress": 0.75,
  "message": "Generating embeddings for target video",
  "matches_found": 12,
  "comments_transferred": 8
}
```

### Frame.io Integration

#### Custom Action Configuration
```json
{
  "name": "Transfer Comments Between Videos",
  "description": "Automatically transfer comments using AI visual matching",
  "endpoint": "https://your-app.vercel.app/api/webhooks/frameio",
  "method": "POST",
  "fields": [
    {
      "name": "source_video",
      "type": "file_select",
      "label": "Source Video (with comments)",
      "required": true
    },
    {
      "name": "target_video", 
      "type": "file_select",
      "label": "Target Video (receive comments)",
      "required": true
    },
    {
      "name": "similarity_threshold",
      "type": "select",
      "label": "Match Sensitivity",
      "options": [
        {"value": 0.7, "label": "High (more matches)"},
        {"value": 0.8, "label": "Medium (balanced)"},
        {"value": 0.9, "label": "Low (precise matches)"}
      ],
      "default": 0.8
    }
  ]
}
```

## Database Schema

### Tables

#### videos
```sql
CREATE TABLE videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frameio_id VARCHAR(255) UNIQUE NOT NULL,
  filename VARCHAR(255) NOT NULL,
  duration_seconds INTEGER,
  frame_count INTEGER,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### frames
```sql
CREATE TABLE frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES videos(id),
  timestamp_seconds DECIMAL(10,3) NOT NULL,
  frame_number INTEGER NOT NULL,
  embedding vector(1536), -- Adjust dimension based on model
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_frames_embedding ON frames USING ivfflat (embedding vector_cosine_ops);
```

#### comments
```sql
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frameio_comment_id VARCHAR(255) UNIQUE NOT NULL,
  video_id UUID REFERENCES videos(id),
  timestamp_seconds DECIMAL(10,3) NOT NULL,
  text TEXT NOT NULL,
  author VARCHAR(255),
  original_timestamp DECIMAL(10,3), -- For transferred comments
  confidence_score DECIMAL(3,2), -- Match confidence
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### processing_jobs
```sql
CREATE TABLE processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_video_id UUID REFERENCES videos(id),
  target_video_id UUID REFERENCES videos(id),
  status VARCHAR(50) DEFAULT 'pending',
  progress DECIMAL(3,2) DEFAULT 0,
  message TEXT,
  matches_found INTEGER DEFAULT 0,
  comments_transferred INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
```

## Implementation Strategy

### Phase 1: Foundation (Week 1)
- [ ] Next.js project setup with Vercel deployment
- [ ] Frame.io v4 API integration and authentication
- [ ] Webhook endpoint with signature verification
- [ ] Basic video file download and temporary storage
- [ ] Neon PostgreSQL setup with pgvector

### Phase 2: Video Processing (Week 2)
- [ ] FFmpeg integration for frame extraction
- [ ] Comment timestamp mapping
- [ ] Frame extraction at regular intervals
- [ ] Temporary file management and cleanup
- [ ] Error handling and logging

### Phase 3: AI & Embeddings (Week 3)
- [ ] Vercel AI SDK integration
- [ ] Multi-modal embedding generation
- [ ] Vector storage in PostgreSQL
- [ ] Basic similarity search implementation
- [ ] Batch processing optimization

### Phase 4: Advanced Matching (Week 4)
- [ ] FAISS integration for fine-grained matching
- [ ] Context window analysis (24-frame before/after)
- [ ] Confidence scoring and thresholding
- [ ] Multiple match handling
- [ ] Match quality assessment

### Phase 5: Comment Transfer (Week 5)
- [ ] Comment creation via Frame.io API
- [ ] Metadata preservation and attribution
- [ ] Batch comment processing
- [ ] User notification system
- [ ] Transfer status tracking

### Phase 6: Integration & Testing (Week 6)
- [ ] Custom action programmatic configuration
- [ ] End-to-end workflow testing
- [ ] Performance optimization
- [ ] Error handling and edge cases
- [ ] User acceptance testing

## Environment Configuration

### Required Environment Variables
```bash
# Frame.io API
FRAMEIO_CLIENT_ID=your_client_id
FRAMEIO_CLIENT_SECRET=your_client_secret
FRAMEIO_WEBHOOK_SECRET=your_webhook_secret

# Database
DATABASE_URL=postgresql://user:pass@host:port/db?sslmode=require

# AI Services
OPENAI_API_KEY=your_openai_key
# or
ANTHROPIC_API_KEY=your_anthropic_key

# Application
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
VERCEL_ENV=production
```

### Vercel Deployment Configuration
```json
{
  "functions": {
    "app/api/webhooks/frameio/route.ts": {
      "maxDuration": 300
    },
    "app/api/process/route.ts": {
      "maxDuration": 900
    }
  },
  "crons": [
    {
      "path": "/api/cleanup",
      "schedule": "0 2 * * *"
    }
  ]
}
```

## Risk Assessment

### Technical Risks
- **AI Accuracy**: Embedding quality may vary across different video content types
  - *Mitigation*: Implement multiple similarity thresholds and manual review options
- **Processing Time**: Large videos may exceed serverless function limits
  - *Mitigation*: Implement chunked processing and background job queuing
- **API Rate Limits**: Frame.io API may throttle requests
  - *Mitigation*: Implement exponential backoff and request queuing

### Business Risks
- **Frame.io API Changes**: Custom Action API is still experimental (V4 API is stable)
  - *Mitigation*: Monitor API updates and implement version detection
- **Cost Scaling**: AI embedding costs may grow with usage
  - *Mitigation*: Implement usage monitoring and cost optimization
- **User Adoption**: Complex setup may deter users
  - *Mitigation*: Provide clear documentation and setup automation

## Success Criteria

### MVP Success Criteria
- [ ] Successfully transfer comments between two video files
- [ ] Achieve >80% accuracy in comment placement
- [ ] Process 5-minute video in <3 minutes
- [ ] Handle basic error scenarios gracefully
- [ ] Deploy to Vercel with Frame.io integration

### Production Success Criteria
- [ ] >85% comment placement accuracy
- [ ] Process 10-minute videos in <5 minutes
- [ ] Support 50+ concurrent users
- [ ] 99.9% uptime for webhook processing
- [ ] Positive user feedback from beta testing

## Future Enhancements

### Phase 2 Features
- **Multi-language Support**: Comment translation during transfer
- **Batch Processing**: Multiple video pair processing
- **Advanced Analytics**: Match quality reporting and insights
- **Custom Matching Rules**: User-defined similarity parameters
- **Integration Expansion**: Support for other video platforms

### Long-term Vision
- **Real-time Processing**: Live comment synchronization during review
- **Machine Learning Optimization**: Self-improving match accuracy
- **Collaborative Features**: Team-based comment management
- **Enterprise Features**: Advanced security and compliance tools

---

**Document Version**: 1.0  
**Last Updated**: September 29, 2025  
**Next Review**: October 6, 2025
