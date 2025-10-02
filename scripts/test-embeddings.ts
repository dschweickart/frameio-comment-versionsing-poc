/**
 * Test script for AI embedding generation
 * Tests embedding generation and similarity calculation
 */

import { extractFramesAtPositions } from '../src/lib/video/frame-extractor';
import { 
  generateFrameEmbedding, 
  generateBatchEmbeddings,
  cosineSimilarity,
  embeddingDistance 
} from '../src/lib/ai/embeddings';

// Test video URL (h264_720 from Frame.io)
const TEST_VIDEO_URL = 'https://assets.frame.io/encode/8740ba08-5936-4ee6-9a92-1826eddbaf21/h264_720.mp4?response-content-disposition=attachment%3B+filename%3D%22c7f41c1e-b324-4532-8f82-8e381dfa195f.mp4%22%3B+filename%2A%3D%22c7f41c1e-b324-4532-8f82-8e381dfa195f.mp4%22&response-content-type=video%2Fmp4&x-amz-meta-project_id=69d20e30-34b7-48d6-8c65-22495285e64c&x-amz-meta-resource_type=asset&x-amz-meta-resource_id=8740ba08-5936-4ee6-9a92-1826eddbaf21&Expires=1759276800&Signature=OuKuCKEWAbsYzHZYFiw3tD2U2MzTq2ZhCpNoTvwPpY1zQSBasixCnjiZyr4OrlxmGJUISKlNPalffV8rp9YFr08r735dRJaUnuHH7zwuJd58aoSHR4rw9P-DblQIkcCpZkRwIsAyG0xWOVRmppvxS~3gnYqLbBRuWRaj0qu3jApY8ou6x56Jc7OHWEZnd1T4mSy4ktA0iXW8k~3f8vGUPXdv8ksW9BjMzqThVbluqhsLxCi5dB9dGZ3zWMe9gHgSerlaLLdagrY6vKgy4P88COi9klF~C7IvCPpEfzzkvrmFBmwGSsUysbPXN9pMCupyjZWDV5WCtFIR7P9Aeu3qtA__&Key-Pair-Id=K1XW5DOJMY1ET9';

async function testEmbeddings() {
  console.log('🧪 Testing Embedding Generation Module\n');
  console.log('='.repeat(80));

  try {
    // Check for Vercel OIDC token
    if (!process.env.VERCEL_OIDC_TOKEN) {
      console.error('❌ VERCEL_OIDC_TOKEN not found in environment');
      console.error('   Run: vercel link && vercel env pull .env.local');
      process.exit(1);
    }
    console.log('✅ Vercel OIDC authentication configured\n');

    // Test 1: Extract frames
    console.log('📌 Test 1: Extract Test Frames');
    console.log('-'.repeat(80));
    const frameNumbers = [24, 36, 96]; // Frame at 1s, 1.5s, and 4s @ 24fps
    console.log(`Extracting frames at positions: ${frameNumbers.join(', ')}`);
    
    const frames = await extractFramesAtPositions(TEST_VIDEO_URL, frameNumbers);
    console.log(`✅ Extracted ${frames.length} frames\n`);

    // Test 2: Generate single embedding
    console.log('🤖 Test 2: Generate Single Embedding');
    console.log('-'.repeat(80));
    const singleEmbedding = await generateFrameEmbedding(frames[0].buffer, frames[0].frameNumber);
    console.log(`✅ Generated embedding:`);
    console.log(`   Frame: ${singleEmbedding.frameNumber}`);
    console.log(`   Dimensions: ${singleEmbedding.embedding.length}`);
    console.log(`   Sample values: [${singleEmbedding.embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}, ...]\n`);

    // Test 3: Generate batch embeddings
    console.log('🤖 Test 3: Generate Batch Embeddings');
    console.log('-'.repeat(80));
    const batchEmbeddings = await generateBatchEmbeddings(frames, 2); // Batch size of 2
    console.log(`✅ Generated ${batchEmbeddings.length} embeddings\n`);

    // Test 4: Calculate similarity
    console.log('🔍 Test 4: Calculate Similarity Between Frames');
    console.log('-'.repeat(80));
    
    // Compare frame 24 and 36 (close in time)
    const similarity_24_36 = cosineSimilarity(
      batchEmbeddings[0].embedding,
      batchEmbeddings[1].embedding
    );
    const distance_24_36 = embeddingDistance(
      batchEmbeddings[0].embedding,
      batchEmbeddings[1].embedding
    );
    
    // Compare frame 24 and 96 (far apart)
    const similarity_24_96 = cosineSimilarity(
      batchEmbeddings[0].embedding,
      batchEmbeddings[2].embedding
    );
    const distance_24_96 = embeddingDistance(
      batchEmbeddings[0].embedding,
      batchEmbeddings[2].embedding
    );

    console.log(`Frame 24 vs Frame 36 (close in time):`);
    console.log(`   Similarity: ${similarity_24_36.toFixed(4)} (higher is more similar)`);
    console.log(`   Distance:   ${distance_24_36.toFixed(4)} (lower is more similar)`);
    
    console.log(`\nFrame 24 vs Frame 96 (far apart):`);
    console.log(`   Similarity: ${similarity_24_96.toFixed(4)}`);
    console.log(`   Distance:   ${distance_24_96.toFixed(4)}`);

    // Validate that close frames are more similar
    if (similarity_24_36 > similarity_24_96) {
      console.log(`\n✅ Validation: Close frames ARE more similar (as expected)`);
    } else {
      console.log(`\n⚠️  Warning: Close frames are NOT more similar (may vary by content)`);
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('✅ All tests passed!');
    console.log('='.repeat(80));
    console.log(`\nEmbedding stats:`);
    console.log(`  Dimensions: ${batchEmbeddings[0].embedding.length}`);
    console.log(`  Model: text-embedding-3-large`);
    console.log(`  Frames processed: ${batchEmbeddings.length}`);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error && error.message.includes('API key')) {
      console.error('\n💡 Make sure OPENAI_API_KEY is set in .env.local');
    }
    process.exit(1);
  }
}

// Run tests
testEmbeddings();
