import { NextRequest, NextResponse } from 'next/server';
import { FrameioClient } from '@/lib/frameio-client';
import { writeFile, unlink, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const downloadedFiles: string[] = [];
  
  try {
    const { accountId, sourceFileId, targetFileId } = await request.json();
    
    if (!accountId || !sourceFileId || !targetFileId) {
      return NextResponse.json(
        { error: 'Missing required fields: accountId, sourceFileId, targetFileId' },
        { status: 400 }
      );
    }
    
    console.log('🎬 Starting video proxy download test');
    console.log(`Account: ${accountId}`);
    console.log(`Source: ${sourceFileId}`);
    console.log(`Target: ${targetFileId}`);
    
    // Create Frame.io client
    const client = await FrameioClient.fromAccountId(accountId);
    if (!client) {
      return NextResponse.json(
        { error: 'Could not authenticate with Frame.io' },
        { status: 401 }
      );
    }
    
    // Fetch file details
    console.log('\n📋 Fetching file details...');
    const [sourceFile, targetFile] = await Promise.all([
      client.getFile(accountId, sourceFileId),
      client.getFile(accountId, targetFileId)
    ]);
    
    console.log(`\nSource file: ${sourceFile.name}`);
    console.log(`  - Media type: ${sourceFile.media_type}`);
    console.log(`  - File size: ${((sourceFile.file_size || 0) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  - Status: ${sourceFile.status}`);
    console.log(`  - Has H264 proxy: ${!!sourceFile.media_links?.video_h264_720}`);
    
    console.log(`\nTarget file: ${targetFile.name}`);
    console.log(`  - Media type: ${targetFile.media_type}`);
    console.log(`  - File size: ${((targetFile.file_size || 0) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  - Status: ${targetFile.status}`);
    console.log(`  - Has H264 proxy: ${!!targetFile.media_links?.video_h264_720}`);
    
    // Check for proxy URLs
    const sourceProxyUrl = sourceFile.media_links?.video_h264_720;
    const targetProxyUrl = targetFile.media_links?.video_h264_720;
    
    if (!sourceProxyUrl || !targetProxyUrl) {
      return NextResponse.json({
        error: 'One or both files do not have H264 proxy available',
        sourceHasProxy: !!sourceProxyUrl,
        targetHasProxy: !!targetProxyUrl,
        note: 'Files might still be processing'
      }, { status: 400 });
    }
    
    // Download source proxy
    console.log('\n⬇️  Downloading source proxy...');
    const sourceDownloadStart = Date.now();
    const sourceResponse = await fetch(sourceProxyUrl);
    
    if (!sourceResponse.ok) {
      throw new Error(`Failed to download source proxy: HTTP ${sourceResponse.status}`);
    }
    
    const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
    const sourceDownloadTime = Date.now() - sourceDownloadStart;
    const sourcePath = join(tmpdir(), `source-${sourceFileId}.mp4`);
    
    await writeFile(sourcePath, sourceBuffer);
    downloadedFiles.push(sourcePath);
    
    const sourceStats = await stat(sourcePath);
    console.log(`✅ Source downloaded: ${(sourceStats.size / 1024 / 1024).toFixed(2)} MB in ${sourceDownloadTime}ms`);
    console.log(`   Path: ${sourcePath}`);
    
    // Download target proxy
    console.log('\n⬇️  Downloading target proxy...');
    const targetDownloadStart = Date.now();
    const targetResponse = await fetch(targetProxyUrl);
    
    if (!targetResponse.ok) {
      throw new Error(`Failed to download target proxy: HTTP ${targetResponse.status}`);
    }
    
    const targetBuffer = Buffer.from(await targetResponse.arrayBuffer());
    const targetDownloadTime = Date.now() - targetDownloadStart;
    const targetPath = join(tmpdir(), `target-${targetFileId}.mp4`);
    
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
    
    // Clean up
    console.log('\n🧹 Cleaning up...');
    for (const filePath of downloadedFiles) {
      await unlink(filePath);
      console.log(`   Deleted: ${filePath}`);
    }
    
    console.log('\n✅ Test complete!');
    
    return NextResponse.json({
      success: true,
      summary: {
        sourceFile: {
          name: sourceFile.name,
          downloadSizeMB: (sourceStats.size / 1024 / 1024).toFixed(2),
          downloadTimeMs: sourceDownloadTime,
        },
        targetFile: {
          name: targetFile.name,
          downloadSizeMB: (targetStats.size / 1024 / 1024).toFixed(2),
          downloadTimeMs: targetDownloadTime,
        },
        total: {
          sizeMB: (totalSize / 1024 / 1024).toFixed(2),
          timeMs: totalTime,
          speedMBps: ((totalSize / 1024 / 1024) / (totalTime / 1000)).toFixed(2),
        },
        tmpDir: tmpdir(),
        cleaned: true
      }
    });
    
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
    
    return NextResponse.json({
      error: 'Video download test failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: '/api/test-video-download',
    method: 'POST',
    description: 'Test downloading video proxies to /tmp and cleanup',
    body: {
      accountId: 'Frame.io account ID',
      sourceFileId: 'Source file ID',
      targetFileId: 'Target file ID'
    },
    example: {
      accountId: 'f6365640-575c-42e5-8a7f-cd9e2d6b9273',
      sourceFileId: '6826a939-26ee-426e-9227-70d517090ef6',
      targetFileId: 'f55aa58a-92a1-422c-93ee-90921ed3c562'
    }
  });
}
