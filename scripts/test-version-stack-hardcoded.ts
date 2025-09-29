/**
 * Simple test script to understand Frame.io V4 API structure
 * Tests version stack validation with hardcoded values
 */

// HARDCODED TEST VALUES - UPDATE THESE
const TEST_CONFIG = {
  accountId: 'f6365640-575c-42e5-8a7f-cd9e2d6b9273', // C2C DEMOS account
  fileId: '6826a939-26ee-426e-9227-70d517090ef6',
  accessToken: 'YOUR_TOKEN_HERE', // Get from database or Vercel logs
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
    const file = await makeFrameioRequest(
      `/accounts/${TEST_CONFIG.accountId}/files/${TEST_CONFIG.fileId}`
    );
    console.log('File data:', JSON.stringify(file, null, 2));
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

    // Step 3: Get the parent to check if it's a version stack
    console.log('\n📁 STEP 2: Get parent details');
    const parent = await makeFrameioRequest(
      `/accounts/${TEST_CONFIG.accountId}/files/${file.parent_id}`
    );
    console.log('Parent data:', JSON.stringify(parent, null, 2));
    console.log('\n🔍 Key fields:', {
      id: parent.id,
      name: parent.name,
      type: parent.type,
    });

    // Step 4: Check if parent is a version stack
    if (parent.type !== 'version_stack') {
      console.log(`\n❌ Parent type is "${parent.type}", not "version_stack"`);
      return;
    }

    console.log('\n✅ Parent IS a version stack!');

    // Step 5: Get version stack details (if there's a separate endpoint)
    console.log('\n📦 STEP 3: Get version stack details');
    try {
      const versionStack = await makeFrameioRequest(
        `/accounts/${TEST_CONFIG.accountId}/version_stacks/${parent.id}`
      );
      console.log('Version stack data:', JSON.stringify(versionStack, null, 2));
    } catch (error) {
      console.log('⚠️  No separate version_stacks endpoint or error:', error instanceof Error ? error.message : error);
    }

    // Step 6: List children (sibling versions)
    console.log('\n👥 STEP 4: List version stack children (siblings)');
    const children = await makeFrameioRequest(
      `/accounts/${TEST_CONFIG.accountId}/folders/${parent.id}/children`
    );
    console.log('Children data:', JSON.stringify(children, null, 2));
    
    if (Array.isArray(children.data)) {
      console.log(`\n✅ Found ${children.data.length} versions in stack:`);
      children.data.forEach((child: any, index: number) => {
        console.log(`  ${index + 1}. ${child.name} (ID: ${child.id})`);
      });
    }

    console.log('\n✅ SUCCESS! Version stack validation complete');
    console.log('\n📋 Summary:');
    console.log(`  - File: ${file.name}`);
    console.log(`  - Version Stack: ${parent.name}`);
    console.log(`  - Total versions: ${Array.isArray(children.data) ? children.data.length : 'unknown'}`);

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

// Run the test
testVersionStackFlow();
