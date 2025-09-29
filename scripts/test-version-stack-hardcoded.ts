/**
 * Simple test script to understand Frame.io V4 API structure
 * Tests version stack validation with hardcoded values
 */

// HARDCODED TEST VALUES - UPDATE THESE
const TEST_CONFIG = {
  accountId: 'f6365640-575c-42e5-8a7f-cd9e2d6b9273', // C2C DEMOS account
  fileId: '6826a939-26ee-426e-9227-70d517090ef6',
  accessToken: 'YOUR_TOKEN_HERE', // Get from database using scripts/get-token.sql
};

const FRAMEIO_API_BASE = 'https://api.frame.io/v4';

async function makeFrameioRequest(endpoint: string) {
  const url = `${FRAMEIO_API_BASE}${endpoint}`;
  console.log(`\n🔵 Calling: ${endpoint}`);
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TEST_CONFIG.accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data;
}

async function testVersionStackFlow() {
  console.log('🧪 Testing Version Stack Validation Flow\n');
  console.log('Test Config:', {
    accountId: TEST_CONFIG.accountId,
    fileId: TEST_CONFIG.fileId,
    hasToken: !!TEST_CONFIG.accessToken && TEST_CONFIG.accessToken !== 'YOUR_TOKEN_HERE',
  });

  if (TEST_CONFIG.accessToken === 'YOUR_TOKEN_HERE') {
    console.error('\n❌ Please update TEST_CONFIG.accessToken with a real token');
    process.exit(1);
  }

  try {
    // Step 1: Get the file details
    console.log('\n📄 STEP 1: Get file details');
    const fileResponse = await makeFrameioRequest(
      `/accounts/${TEST_CONFIG.accountId}/files/${TEST_CONFIG.fileId}`
    );
    console.log('File data:', JSON.stringify(fileResponse, null, 2));
    
    // Extract from nested 'data' property
    const file = fileResponse.data || fileResponse;
    console.log('\n🔍 Key fields:', {
      id: file.id,
      name: file.name,
      type: file.type,
      parent_id: file.parent_id,
    });

    // Step 2: Check if file has a parent
    if (!file.parent_id) {
      console.log('\n❌ File has no parent_id - not in a version stack');
      return;
    }

    // Step 3: Try to list children from parent_id
    // If this works, parent_id is a version stack
    console.log('\n📦 STEP 2: List version stack children (siblings)');
    console.log(`Trying: /version_stacks/${file.parent_id}/children`);
    
    let childrenResponse;
    try {
      childrenResponse = await makeFrameioRequest(
        `/accounts/${TEST_CONFIG.accountId}/version_stacks/${file.parent_id}/children`
      );
      console.log('✅ Parent IS a version stack!');
    } catch (error) {
      console.log(`\n❌ Failed to list children: ${error instanceof Error ? error.message : error}`);
      console.log('This likely means the parent_id is NOT a version stack.');
      return;
    }
    console.log('Children data:', JSON.stringify(childrenResponse, null, 2));
    
    // Extract from nested 'data' property
    const children = childrenResponse.data || childrenResponse;
    const childrenArray = Array.isArray(children) ? children : (Array.isArray(children.data) ? children.data : []);
    
    if (childrenArray.length > 0) {
      console.log(`\n✅ Found ${childrenArray.length} versions in stack:`);
      childrenArray.forEach((child: any, index: number) => {
        console.log(`  ${index + 1}. ${child.name} (ID: ${child.id})`);
      });
    }

    console.log('\n✅ SUCCESS! Version stack validation complete');
    
    // Format the output for custom action form
    console.log('\n📋 CUSTOM ACTION FORM DATA:');
    console.log('=' .repeat(60));
    
    // Target file (the file that triggered the webhook)
    console.log('\n🎯 TARGET FILE (from webhook):');
    console.log(`  ID: ${file.id}`);
    console.log(`  Name: ${file.name}`);
    console.log(`  Media Type: ${file.media_type}`);
    console.log(`  File Size: ${(file.file_size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Status: ${file.status}`);
    
    // Source file options (all OTHER versions in the stack)
    const sourceFiles = childrenArray.filter((child: any) => child.id !== file.id);
    console.log('\n📂 SOURCE FILE OPTIONS (other versions in stack):');
    if (sourceFiles.length === 0) {
      console.log('  ⚠️  No other versions in stack - cannot compare!');
    } else {
      sourceFiles.forEach((source: any, index: number) => {
        console.log(`\n  Option ${index + 1}:`);
        console.log(`    ID: ${source.id}`);
        console.log(`    Name: ${source.name}`);
        console.log(`    Media Type: ${source.media_type}`);
        console.log(`    File Size: ${(source.file_size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`    Status: ${source.status}`);
      });
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Summary:');
    console.log(`  - Version Stack ID: ${file.parent_id}`);
    console.log(`  - Total versions: ${childrenArray.length}`);
    console.log(`  - Target file: ${file.name}`);
    console.log(`  - Source file options: ${sourceFiles.length}`);

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

// Run the test
testVersionStackFlow();
