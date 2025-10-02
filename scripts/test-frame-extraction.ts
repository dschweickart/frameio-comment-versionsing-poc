/**
 * Test script for FFmpeg frame extraction
 * Tests both specific frame positions and keyframe extraction
 */

import { 
  extractFramesAtPositions, 
  extractKeyframes,
  getVideoMetadata 
} from '../src/lib/video/frame-extractor';

// Test video URL (h264_720 from Frame.io)
const TEST_VIDEO_URL = 'https://assets.frame.io/encode/8740ba08-5936-4ee6-9a92-1826eddbaf21/h264_720.mp4?response-content-disposition=attachment%3B+filename%3D%22c7f41c1e-b324-4532-8f82-8e381dfa195f.mp4%22%3B+filename%2A%3D%22c7f41c1e-b324-4532-8f82-8e381dfa195f.mp4%22&response-content-type=video%2Fmp4&x-amz-meta-project_id=69d20e30-34b7-48d6-8c65-22495285e64c&x-amz-meta-resource_type=asset&x-amz-meta-resource_id=8740ba08-5936-4ee6-9a92-1826eddbaf21&Expires=1759276800&Signature=OuKuCKEWAbsYzHZYFiw3tD2U2MzTq2ZhCpNoTvwPpY1zQSBasixCnjiZyr4OrlxmGJUISKlNPalffV8rp9YFr08r735dRJaUnuHH7zwuJd58aoSHR4rw9P-DblQIkcCpZkRwIsAyG0xWOVRmppvxS~3gnYqLbBRuWRaj0qu3jApY8ou6x56Jc7OHWEZnd1T4mSy4ktA0iXW8k~3f8vGUPXdv8ksW9BjMzqThVbluqhsLxCi5dB9dGZ3zWMe9gHgSerlaLLdagrY6vKgy4P88COi9klF~C7IvCPpEfzzkvrmFBmwGSsUysbPXN9pMCupyjZWDV5WCtFIR7P9Aeu3qtA__&Key-Pair-Id=K1XW5DOJMY1ET9';

async function testFrameExtraction() {
  console.log('🧪 Testing Frame Extraction Module\n');
  console.log('='.repeat(80));

  try {
    // Test 1: Get video metadata
    console.log('\n📊 Test 1: Get Video Metadata');
    console.log('-'.repeat(80));
    const metadata = await getVideoMetadata(TEST_VIDEO_URL);
    console.log('Video metadata:');
    console.log(`  Resolution: ${metadata.width}x${metadata.height}`);
    console.log(`  FPS: ${metadata.fps}`);
    console.log(`  Duration: ${metadata.duration}s`);
    console.log(`  Total frames: ${metadata.frameCount}`);

    // Test 2: Extract frames at specific positions (simulating comments)
    console.log('\n📌 Test 2: Extract Frames at Specific Positions');
    console.log('-'.repeat(80));
    const commentFrames = [24, 60, 96]; // Frames at 1s, 2.5s, 4s @ 24fps
    console.log(`Extracting frames at positions: ${commentFrames.join(', ')}`);
    
    const extractedFrames = await extractFramesAtPositions(TEST_VIDEO_URL, commentFrames);
    console.log(`\n✅ Extracted ${extractedFrames.length} frames:`);
    extractedFrames.forEach(frame => {
      const sizeKB = (frame.buffer.length / 1024).toFixed(1);
      console.log(`  Frame ${frame.frameNumber}: ${sizeKB} KB`);
    });

    // Test 3: Extract keyframes at intervals
    console.log('\n🔑 Test 3: Extract Keyframes at Intervals');
    console.log('-'.repeat(80));
    const intervalFrames = 12; // Every 12 frames = 0.5s @ 24fps
    console.log(`Extracting keyframes every ${intervalFrames} frames...`);
    
    const keyframes = await extractKeyframes(TEST_VIDEO_URL, intervalFrames);
    console.log(`\n✅ Extracted ${keyframes.length} keyframes:`);
    keyframes.slice(0, 5).forEach(frame => {
      const sizeKB = (frame.buffer.length / 1024).toFixed(1);
      console.log(`  Frame ${frame.frameNumber}: ${sizeKB} KB`);
    });
    if (keyframes.length > 5) {
      console.log(`  ... and ${keyframes.length - 5} more`);
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('✅ All tests passed!');
    console.log('='.repeat(80));
    
    // Calculate total size
    const totalSize = [...extractedFrames, ...keyframes].reduce((sum, f) => sum + f.buffer.length, 0);
    console.log(`\nTotal extracted: ${extractedFrames.length + keyframes.length} frames`);
    console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
testFrameExtraction();
