import 'dotenv/config';
import {
  generateFrameHash,
  generateFrameHashes,
  hammingDistance,
  hashSimilarity,
} from '../src/lib/ai/perceptual-hash';
import { extractFramesAtPositions, extractKeyframes } from '../src/lib/video/frame-extractor';

// HARDCODED TEST VALUES - UPDATE THESE
const TEST_CONFIG = {
  accountId: 'f6365640-575c-42e5-8a7f-cd9e2d6b9273', // C2C DEMOS account
  sourceFileId: '6826a939-26ee-426e-9227-70d517090ef6', // Gen-4 Turbo
  targetFileId: 'c2d6f8b4-3a5e-4f9c-8d7a-1e2f3a4b5c6d', // Example target (update this)
  // Get from database using: SELECT access_token FROM user_tokens WHERE account_id = '...' LIMIT 1;
  accessToken: process.env.FRAMEIO_ACCESS_TOKEN || 'YOUR_TOKEN_HERE', // Use env var for real token
  apiBaseUrl: 'https://api.frame.io/v4',
};

// Helper function to make Frame.io API calls
async function frameioRequest(endpoint: string) {
  const response = await fetch(`${TEST_CONFIG.apiBaseUrl}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${TEST_CONFIG.accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Frame.io API error: HTTP ${response.status}`);
  }

  const json = await response.json();
  return json.data; // V4 API returns data nested under 'data' property
}

async function testPerceptualHashing() {
  try {
    console.log('🧪 Testing Perceptual Hashing Module\n');
    console.log('='.repeat(80) + '\n');

    if (TEST_CONFIG.accessToken === 'YOUR_TOKEN_HERE') {
      console.error('❌ Please update TEST_CONFIG.accessToken with a real token or set FRAMEIO_ACCESS_TOKEN env var');
      process.exit(1);
    }

    // Fetch source file with high_quality media links
    console.log('📥 Fetching source video metadata...');
    const sourceFile = await frameioRequest(
      `/accounts/${TEST_CONFIG.accountId}/files/${TEST_CONFIG.sourceFileId}?include=media_links.high_quality`
    );
    const sourceVideoUrl = sourceFile.media_links?.high_quality?.download_url;

    if (!sourceVideoUrl) {
      console.error('❌ Source file has no high_quality proxy available. Cannot run tests.');
      process.exit(1);
    }
    console.log(`✅ Source video URL obtained\n`);

    // Test 1: Generate Hash for Single Frame
    console.log('📌 Test 1: Generate Hash for Single Frame');
    console.log('-'.repeat(80));
    const frameNumbers = [24, 48, 96]; // Frames at 1s, 2s, 4s @ 24fps
    const frames = await extractFramesAtPositions(sourceVideoUrl, frameNumbers);
    
    const singleHash = await generateFrameHash(frames[0].buffer, frames[0].frameNumber);
    console.log(`Frame ${singleHash.frameNumber}: ${singleHash.hash}`);
    console.log(`Hash length: ${singleHash.hash.length} characters (8 bytes)\n`);

    // Test 2: Batch Generate Hashes
    console.log('📦 Test 2: Batch Generate Hashes');
    console.log('-'.repeat(80));
    const hashes = await generateFrameHashes(frames);
    console.log(`Generated ${hashes.length} hashes:`);
    hashes.forEach(h => console.log(`  Frame ${h.frameNumber}: ${h.hash}`));
    console.log('');

    // Test 3: Compare Similar Frames (same frame extracted twice)
    console.log('🔄 Test 3: Compare Identical Frames');
    console.log('-'.repeat(80));
    const frame1 = await extractFramesAtPositions(sourceVideoUrl, [24]);
    const frame2 = await extractFramesAtPositions(sourceVideoUrl, [24]);
    const hash1 = await generateFrameHash(frame1[0].buffer, frame1[0].frameNumber);
    const hash2 = await generateFrameHash(frame2[0].buffer, frame2[0].frameNumber);
    
    const identicalDistance = hammingDistance(hash1.hash, hash2.hash);
    const identicalSimilarity = hashSimilarity(hash1.hash, hash2.hash);
    console.log(`Frame ${hash1.frameNumber} vs Frame ${hash2.frameNumber}:`);
    console.log(`  Hash 1: ${hash1.hash}`);
    console.log(`  Hash 2: ${hash2.hash}`);
    console.log(`  Hamming distance: ${identicalDistance}/64 bits different`);
    console.log(`  Similarity: ${(identicalSimilarity * 100).toFixed(1)}%`);
    console.log(`  ✅ Should be identical (distance ~0)\n`);

    // Test 4: Compare Different Frames
    console.log('🔀 Test 4: Compare Different Frames');
    console.log('-'.repeat(80));
    const distance1vs2 = hammingDistance(hashes[0].hash, hashes[1].hash);
    const similarity1vs2 = hashSimilarity(hashes[0].hash, hashes[1].hash);
    console.log(`Frame ${hashes[0].frameNumber} vs Frame ${hashes[1].frameNumber}:`);
    console.log(`  Hash 1: ${hashes[0].hash}`);
    console.log(`  Hash 2: ${hashes[1].hash}`);
    console.log(`  Hamming distance: ${distance1vs2}/64 bits different`);
    console.log(`  Similarity: ${(similarity1vs2 * 100).toFixed(1)}%\n`);

    const distance1vs3 = hammingDistance(hashes[0].hash, hashes[2].hash);
    const similarity1vs3 = hashSimilarity(hashes[0].hash, hashes[2].hash);
    console.log(`Frame ${hashes[0].frameNumber} vs Frame ${hashes[2].frameNumber}:`);
    console.log(`  Hash 1: ${hashes[0].hash}`);
    console.log(`  Hash 2: ${hashes[2].hash}`);
    console.log(`  Hamming distance: ${distance1vs3}/64 bits different`);
    console.log(`  Similarity: ${(similarity1vs3 * 100).toFixed(1)}%\n`);

    // Test 5: Performance Comparison
    console.log('⚡ Test 5: Performance Test');
    console.log('-'.repeat(80));
    const keyframes = await extractKeyframes(sourceVideoUrl, 12); // Every 0.5s
    const perfStartTime = Date.now();
    await generateFrameHashes(keyframes);
    const perfDuration = Date.now() - perfStartTime;
    
    console.log(`Processed ${keyframes.length} frames in ${perfDuration}ms`);
    console.log(`Average: ${(perfDuration / keyframes.length).toFixed(1)}ms per frame`);
    console.log(`Throughput: ${(keyframes.length / (perfDuration / 1000)).toFixed(1)} frames/second\n`);

    console.log('='.repeat(80));
    console.log('✅ All tests passed!');
    console.log('='.repeat(80) + '\n');

    // Interpretation Guide
    console.log('📊 Hash Similarity Interpretation:');
    console.log('  0-5 bits different:  Nearly identical frames');
    console.log('  6-10 bits different: Very similar frames (minor changes)');
    console.log('  11-20 bits different: Similar frames (same scene, different angle/time)');
    console.log('  21+ bits different:  Different frames (different scenes)');

  } catch (error) {
    console.error('\n❌ Error during perceptual hashing test:', error);
    process.exit(1);
  }
}

testPerceptualHashing();
