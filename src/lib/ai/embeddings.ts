import { embed } from 'ai';

export interface FrameEmbedding {
  frameNumber: number;
  embedding: number[];
}

/**
 * Generate a multi-modal embedding for a video frame
 * Uses OpenAI's vision-capable embedding model via Vercel AI Gateway
 * 
 * Vercel AI Gateway unifies access to all LLM providers (OpenAI, xAI, Anthropic, etc.)
 * No need for individual provider API keys!
 * 
 * Authentication: Uses OIDC token from Vercel (automatically set via `vercel env pull`)
 * The OIDC token is valid for 12 hours and is stored in VERCEL_OIDC_TOKEN
 */
export async function generateFrameEmbedding(
  frameBuffer: Buffer,
  frameNumber: number
): Promise<FrameEmbedding> {
  console.log(`🤖 Generating embedding for frame ${frameNumber}...`);

  try {
    // Convert buffer to base64 data URL
    const base64Image = frameBuffer.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;

    // Generate embedding using Vercel AI Gateway
    // Using model string directly routes through AI Gateway
    const startTime = Date.now();
    const { embedding } = await embed({
      model: 'openai/text-embedding-3-large',
      value: dataUrl,
    });

    const duration = Date.now() - startTime;
    console.log(`✅ Generated embedding for frame ${frameNumber} in ${duration}ms (${embedding.length} dimensions)`);

    return {
      frameNumber,
      embedding,
    };
  } catch (error) {
    console.error(`❌ Failed to generate embedding for frame ${frameNumber}:`, error);
    throw new Error(
      `Embedding generation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate embeddings for multiple frames in batches
 * Processes frames in parallel with configurable batch size
 */
export async function generateBatchEmbeddings(
  frames: Array<{ frameNumber: number; buffer: Buffer }>,
  batchSize: number = 5
): Promise<FrameEmbedding[]> {
  console.log(`🤖 Generating embeddings for ${frames.length} frames in batches of ${batchSize}...`);

  const embeddings: FrameEmbedding[] = [];
  const startTime = Date.now();

  // Process in batches to avoid overwhelming the API
  for (let i = 0; i < frames.length; i += batchSize) {
    const batch = frames.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(frames.length / batchSize)}...`);

    const batchEmbeddings = await Promise.all(
      batch.map(frame => generateFrameEmbedding(frame.buffer, frame.frameNumber))
    );

    embeddings.push(...batchEmbeddings);
  }

  const duration = Date.now() - startTime;
  const avgTime = duration / frames.length;
  console.log(`✅ Generated ${embeddings.length} embeddings in ${duration}ms (avg ${avgTime.toFixed(0)}ms per frame)`);

  return embeddings;
}

/**
 * Calculate cosine similarity between two embedding vectors
 * Returns a value between -1 (opposite) and 1 (identical)
 * For matching, we typically use distance = 1 - similarity
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embedding vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return similarity;
}

/**
 * Calculate distance between two embeddings (1 - cosine similarity)
 * Lower values indicate more similar frames
 */
export function embeddingDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}
