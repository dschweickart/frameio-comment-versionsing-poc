/**
 * Test script for version stack validation
 * 
 * Usage: npx tsx scripts/test-version-stack.ts
 */

import { FrameioClient } from '../src/lib/frameio-client';
import { validateVersionStack, formatVersionsForSelection } from '../src/lib/video/version-stack-validator';

const ACCOUNT_ID = 'f6365640-575c-42e5-8a7f-cd9e2d6b9273';
const FILE_ID = '6826a939-26ee-426e-9227-70d517090ef6';

async function testVersionStack() {
  console.log('\n🧪 Testing Version Stack Validation\n');
  console.log('Account ID:', ACCOUNT_ID);
  console.log('File ID:', FILE_ID);
  console.log('\n' + '='.repeat(80) + '\n');

  try {
    // Get client from session
    console.log('📡 Creating Frame.io client from session...');
    const client = await FrameioClient.fromSession();
    
    if (!client) {
      console.error('❌ Not authenticated. Please sign in first.');
      process.exit(1);
    }
    console.log('✅ Client authenticated\n');

    // Validate version stack
    console.log('🔍 Validating version stack...');
    const validation = await validateVersionStack(client, ACCOUNT_ID, FILE_ID);

    if (!validation.isValid) {
      console.error('❌ Validation failed:', validation.error);
      if (validation.file) {
        console.log('\n📄 File details:');
        console.log(JSON.stringify(validation.file, null, 2));
      }
      process.exit(1);
    }

    console.log('✅ File is in a version stack!\n');

    // Display version stack details
    if (validation.versionStack) {
      console.log('📦 Version Stack Details:');
      console.log('  ID:', validation.versionStack.id);
      console.log('  Name:', validation.versionStack.name);
      console.log('  Type:', validation.versionStack.type);
      console.log('  Parent ID:', validation.versionStack.parent_id);
      console.log('  Project ID:', validation.versionStack.project_id);
      if (validation.versionStack.version_count) {
        console.log('  Version Count:', validation.versionStack.version_count);
      }
      console.log('');
    }

    // Display all versions (siblings)
    if (validation.versions && validation.versions.length > 0) {
      console.log('🎬 All Versions in Stack:');
      console.log('');
      
      const formattedVersions = formatVersionsForSelection(validation.versions);
      
      formattedVersions.forEach((version, index) => {
        const isCurrent = version.id === FILE_ID;
        const marker = isCurrent ? '👉' : '  ';
        
        console.log(`${marker} Version ${index + 1}${isCurrent ? ' (Current)' : ''}`);
        console.log(`   ID: ${version.id}`);
        console.log(`   Name: ${version.name}`);
        if (version.filesize) {
          console.log(`   Size: ${(version.filesize / 1024 / 1024).toFixed(2)} MB`);
        }
        if (version.duration) {
          console.log(`   Duration: ${Math.floor(version.duration)}s`);
        }
        console.log(`   Has Video Proxy: ${version.hasVideoProxy ? '✅' : '❌'}`);
        console.log('');
      });
    }

    // Display current file details
    if (validation.file) {
      console.log('📄 Current File Details:');
      console.log('  ID:', validation.file.id);
      console.log('  Name:', validation.file.name);
      console.log('  Type:', validation.file.type);
      console.log('  Parent ID:', validation.file.parent_id);
      if (validation.file.media_links?.video_h264_720) {
        console.log('  Video Proxy URL:', validation.file.media_links.video_h264_720.substring(0, 60) + '...');
      }
      console.log('');
    }

    console.log('='.repeat(80));
    console.log('✅ Test completed successfully!');
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ Error during test:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testVersionStack().catch(console.error);
