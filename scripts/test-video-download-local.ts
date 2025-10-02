/**
 * Local test script for video proxy download
 * Run with: npm run test:download
 * 
 * NOTE: This script uses a hardcoded token to avoid database dependencies.
 * Get your token from the database first using scripts/get-token.sql
 */

import { writeFile, unlink, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// HARDCODED TEST VALUES - UPDATE THESE
const TEST_CONFIG = {
  accountId: 'f6365640-575c-42e5-8a7f-cd9e2d6b9273', // C2C DEMOS account
  sourceFileId: '6826a939-26ee-426e-9227-70d517090ef6',  // Gen-4 Turbo
  targetFileId: 'f55aa58a-92a1-422c-93ee-90921ed3c562',  // DSC_2179.MOV
  // Get from database using: SELECT access_token FROM user_tokens WHERE account_id = '...' LIMIT 1;
  // Or set FRAMEIO_ACCESS_TOKEN env var
  accessToken: process.env.FRAMEIO_ACCESS_TOKEN || '',
  apiBaseUrl: 'https://api.frame.io/v4',
};

async function testVideoDownload() {
  const startTime = Date.now();
  const downloadedFiles: string[] = [];
  
  try {
    console.log('🎬 Starting local video proxy download test\n');
    console.log(`Account: ${TEST_CONFIG.accountId}`);
    console.log(`Source: ${TEST_CONFIG.sourceFileId}`);
    console.log(`Target: ${TEST_CONFIG.targetFileId}\n`);
    
    if (TEST_CONFIG.accessToken === 'YOUR_TOKEN_HERE') {
      console.error('❌ Please update TEST_CONFIG.accessToken with a real token');
      console.error('   Get it from database: SELECT access_token FROM user_tokens WHERE account_id = \'...\' LIMIT 1;');
      process.exit(1);
    }
    
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
    
    // Test getting different media link types
    console.log('📋 Testing media link variations...\n');
    
    const includeTests = [
      'media_links.original',
      'media_links.efficient',
      'media_links.high_quality',
      'media_links.video_h264_360',
      'media_links.video_h264_540',
      'media_links.video_h264_720',
      'media_links.video_h264_1080',
      'media_links.video_h264_2160',
    ];
    
    console.log(`Testing source file (transcoded): ${TEST_CONFIG.sourceFileId}`);
    console.log(`Testing target file (uploaded): ${TEST_CONFIG.targetFileId}\n`);
    
    for (const includeParam of includeTests) {
      console.log(`🔍 Testing include=${includeParam}...`);
      try {
        const response = await frameioRequest(`/accounts/${TEST_CONFIG.accountId}/files/${TEST_CONFIG.sourceFileId}?include=${includeParam}`);
        
        if (response.media_links) {
          const mediaLinkKeys = Object.keys(response.media_links);
          console.log(`   ✅ SUCCESS! Found media_links keys: ${mediaLinkKeys.join(', ')}`);
          
          // Show the actual URLs for this resolution
          Object.entries(response.media_links).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
              console.log(`   ${key}:`);
              Object.entries(value as Record<string, any>).forEach(([urlKey, url]) => {
                if (typeof url === 'string') {
                  console.log(`     - ${urlKey}: ${url.substring(0, 60)}...`);
                }
              });
            }
          });
          console.log('');
        } else {
          console.log(`   ⚠️  No media_links in response\n`);
        }
      } catch (error) {
        console.log(`   ❌ ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    
    // Fetch files with high_quality media links
    console.log('📥 Fetching files with high_quality proxy URLs...\n');
    const [sourceFile, targetFile] = await Promise.all([
      frameioRequest(`/accounts/${TEST_CONFIG.accountId}/files/${TEST_CONFIG.sourceFileId}?include=media_links.high_quality`),
      frameioRequest(`/accounts/${TEST_CONFIG.accountId}/files/${TEST_CONFIG.targetFileId}?include=media_links.high_quality`)
    ]);
    
    console.log('✅ Files fetched with media links');
    
    console.log(`\n📄 Source file: ${sourceFile.name}`);
    console.log(`   Media type: ${sourceFile.media_type}`);
    console.log(`   File size: ${((sourceFile.file_size || 0) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Status: ${sourceFile.status}`);
    console.log(`   Duration: ${sourceFile.duration}s`);
    
    // Inspect all available media links
    console.log(`\n   Available media links:`);
    if (sourceFile.media_links) {
      Object.keys(sourceFile.media_links).forEach(key => {
        if (typeof sourceFile.media_links![key] === 'string') {
          console.log(`     - ${key}: ${(sourceFile.media_links![key] as string).substring(0, 80)}...`);
        }
      });
    } else {
      console.log('     (none)');
    }
    
    console.log(`\n📄 Target file: ${targetFile.name}`);
    console.log(`   Media type: ${targetFile.media_type}`);
    console.log(`   File size: ${((targetFile.file_size || 0) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Status: ${targetFile.status}`);
    console.log(`   Duration: ${targetFile.duration}s`);
    
    console.log(`\n   Available media links:`);
    if (targetFile.media_links) {
      Object.keys(targetFile.media_links).forEach(key => {
        if (typeof targetFile.media_links![key] === 'string') {
          console.log(`     - ${key}: ${(targetFile.media_links![key] as string).substring(0, 80)}...`);
        }
      });
    } else {
      console.log('     (none)');
    }
    
    // Get proxy URLs (prefer high_quality, fallback to efficient)
    const sourceProxyUrl = sourceFile.media_links?.high_quality?.download_url || 
                          sourceFile.media_links?.efficient?.download_url;
    const targetProxyUrl = targetFile.media_links?.high_quality?.download_url ||
                          targetFile.media_links?.efficient?.download_url;
    
    if (!sourceProxyUrl) {
      console.error('\n❌ Source file has no high_quality or efficient proxy available');
      console.error('   File status:', sourceFile.status);
      console.error('   Media links:', sourceFile.media_links ? Object.keys(sourceFile.media_links).join(', ') : 'none');
      console.error('   This might mean the file is still processing');
      process.exit(1);
    }
    
    if (!targetProxyUrl) {
      console.error('\n❌ Target file has no high_quality or efficient proxy available');
      console.error('   File status:', targetFile.status);
      console.error('   Media links:', targetFile.media_links ? Object.keys(targetFile.media_links).join(', ') : 'none');
      console.error('   This might mean the file is still processing');
      process.exit(1);
    }
    
    console.log('\n✅ Both files have proxy URLs');
    console.log(`   Source: ${sourceProxyUrl.substring(0, 80)}...`);
    console.log(`   Target: ${targetProxyUrl.substring(0, 80)}...`);
    
    // Download source proxy
    console.log('\n⬇️  Downloading source proxy...');
    const sourceDownloadStart = Date.now();
    const sourceResponse = await fetch(sourceProxyUrl as string);
    
    if (!sourceResponse.ok) {
      throw new Error(`Failed to download source proxy: HTTP ${sourceResponse.status}`);
    }
    
    const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
    const sourceDownloadTime = Date.now() - sourceDownloadStart;
    const sourcePath = join(tmpdir(), `source-${TEST_CONFIG.sourceFileId}.mp4`);
    
    await writeFile(sourcePath, sourceBuffer);
    downloadedFiles.push(sourcePath);
    
    const sourceStats = await stat(sourcePath);
    console.log(`✅ Source downloaded: ${(sourceStats.size / 1024 / 1024).toFixed(2)} MB in ${sourceDownloadTime}ms`);
    console.log(`   Path: ${sourcePath}`);
    
    // Download target proxy
    console.log('\n⬇️  Downloading target proxy...');
    const targetDownloadStart = Date.now();
    const targetResponse = await fetch(targetProxyUrl as string);
    
    if (!targetResponse.ok) {
      throw new Error(`Failed to download target proxy: HTTP ${targetResponse.status}`);
    }
    
    const targetBuffer = Buffer.from(await targetResponse.arrayBuffer());
    const targetDownloadTime = Date.now() - targetDownloadStart;
    const targetPath = join(tmpdir(), `target-${TEST_CONFIG.targetFileId}.mp4`);
    
    await writeFile(targetPath, targetBuffer);
    downloadedFiles.push(targetPath);
    
    const targetStats = await stat(targetPath);
    console.log(`✅ Target downloaded: ${(targetStats.size / 1024 / 1024).toFixed(2)} MB in ${targetDownloadTime}ms`);
    console.log(`   Path: ${targetPath}`);
    
    // Calculate total stats
    const totalTime = Date.now() - startTime;
    const totalSize = sourceStats.size + targetStats.size;
    
    console.log('\n📊 Download Summary:');
    console.log(`   Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Total time: ${totalTime}ms`);
    console.log(`   Average speed: ${((totalSize / 1024 / 1024) / (totalTime / 1000)).toFixed(2)} MB/s`);
    console.log(`   Tmp directory: ${tmpdir()}`);
    
    // Use ffprobe to inspect video properties
    console.log('\n🔍 Inspecting videos with ffprobe...');
    
    try {
      const { execSync } = await import('child_process');
      
      console.log('\n📹 Source video (high_quality or efficient proxy):');
      const sourceInfo = execSync(
        `ffprobe -v quiet -print_format json -show_format -show_streams "${sourcePath}"`,
        { encoding: 'utf8' }
      );
      const sourceData = JSON.parse(sourceInfo);
      const sourceVideoStream = sourceData.streams.find((s: any) => s.codec_type === 'video');
      
      if (sourceVideoStream) {
        console.log(`   Codec: ${sourceVideoStream.codec_name} (${sourceVideoStream.profile || 'N/A'})`);
        console.log(`   Resolution: ${sourceVideoStream.width}x${sourceVideoStream.height}`);
        console.log(`   Frame rate: ${sourceVideoStream.r_frame_rate} (avg: ${sourceVideoStream.avg_frame_rate})`);
        console.log(`   Duration: ${parseFloat(sourceData.format.duration).toFixed(2)}s`);
        console.log(`   Bitrate: ${(parseInt(sourceData.format.bit_rate) / 1000).toFixed(0)} kbps`);
        console.log(`   Pixel format: ${sourceVideoStream.pix_fmt || 'N/A'}`);
      }
      
      console.log('\n📹 Target video (high_quality or efficient proxy):');
      const targetInfo = execSync(
        `ffprobe -v quiet -print_format json -show_format -show_streams "${targetPath}"`,
        { encoding: 'utf8' }
      );
      const targetData = JSON.parse(targetInfo);
      const targetVideoStream = targetData.streams.find((s: any) => s.codec_type === 'video');
      
      if (targetVideoStream) {
        console.log(`   Codec: ${targetVideoStream.codec_name} (${targetVideoStream.profile || 'N/A'})`);
        console.log(`   Resolution: ${targetVideoStream.width}x${targetVideoStream.height}`);
        console.log(`   Frame rate: ${targetVideoStream.r_frame_rate} (avg: ${targetVideoStream.avg_frame_rate})`);
        console.log(`   Duration: ${parseFloat(targetData.format.duration).toFixed(2)}s`);
        console.log(`   Bitrate: ${(parseInt(targetData.format.bit_rate) / 1000).toFixed(0)} kbps`);
        console.log(`   Pixel format: ${targetVideoStream.pix_fmt || 'N/A'}`);
      }
    } catch (ffprobeError) {
      console.error('\n⚠️  ffprobe failed:', ffprobeError instanceof Error ? ffprobeError.message : String(ffprobeError));
      console.error('   Make sure ffmpeg/ffprobe is installed: brew install ffmpeg');
    }
    
    // Clean up
    console.log('\n🧹 Cleaning up...');
    for (const filePath of downloadedFiles) {
      await unlink(filePath);
      console.log(`   Deleted: ${filePath}`);
    }
    
    console.log('\n✅ Test complete!');
    
  } catch (error) {
    console.error('\n❌ Error during video download test:', error);
    
    // Clean up any downloaded files on error
    for (const filePath of downloadedFiles) {
      try {
        await unlink(filePath);
        console.log(`   Cleaned up: ${filePath}`);
      } catch {
        // File might not exist
      }
    }
    
    process.exit(1);
  }
}

// Run the test
testVideoDownload();
