import 'dotenv/config';
import { db, processingJobs } from '../src/lib/db';
import { processJob } from '../src/lib/video/process-job';

// REAL FRAME.IO DATA
const TEST_DATA = {
  accountId: 'f6365640-575c-42e5-8a7f-cd9e2d6b9273', // C2C DEMOS account
  sourceFileId: '5bfa3e30-a214-42b6-89f5-e9a357c182cb', // Source video (with comments)
  targetFileId: '17f55297-5085-40fb-88c5-bc9761cfcd66', // Target video (will receive comments)
};

async function testEndToEnd() {
  console.log('🧪 End-to-End Comment Transfer Test\n');
  console.log('='.repeat(80));
  console.log('Using REAL Frame.io data:');
  console.log(`  Account: ${TEST_DATA.accountId}`);
  console.log(`  Source:  ${TEST_DATA.sourceFileId}`);
  console.log(`  Target:  ${TEST_DATA.targetFileId}`);
  console.log('\n⚠️  NOTE: This is a 30-minute video!');
  console.log('   - Extraction will take time (~1-2 minutes)');
  console.log('   - Watch for chunk-by-chunk progress updates');
  console.log('='.repeat(80) + '\n');

  try {
    // Step 1: Create a test processing job
    console.log('📝 Creating test processing job...\n');
    
    const [job] = await db.insert(processingJobs).values({
      accountId: TEST_DATA.accountId,
      sourceFileId: TEST_DATA.sourceFileId,
      targetFileId: TEST_DATA.targetFileId,
      status: 'pending',
      userId: 'test-user',
      userName: 'Test User',
      userEmail: 'test@example.com',
      metadata: JSON.stringify({
        sensitivity: 'medium',
        test: true,
        triggeredAt: new Date().toISOString(),
      }),
    }).returning();

    console.log(`✅ Job created with ID: ${job.id}\n`);
    console.log('='.repeat(80) + '\n');

    // Step 2: Process the job (this runs the entire pipeline)
    console.log('🚀 Starting comment transfer processing...\n');
    
    const startTime = Date.now();
    const result = await processJob(job.id);
    const duration = Date.now() - startTime;

    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL RESULTS');
    console.log('='.repeat(80));
    console.log(`⏱️  Total Duration: ${(duration / 1000).toFixed(1)} seconds`);
    console.log(`✅ Success: ${result.success}`);
    console.log(`📤 Transferred: ${result.transferred}`);
    console.log(`⏭️  Skipped: ${result.skipped}`);
    console.log(`❌ Failed: ${result.failed}`);
    console.log(`💬 Message: ${result.message}`);
    console.log('='.repeat(80) + '\n');

    // Step 3: Show job details from database
    const finalJob = await db.query.processingJobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.id, job.id),
    });

    if (finalJob) {
      console.log('📋 Job Record:');
      console.log(`   Status: ${finalJob.status}`);
      console.log(`   Progress: ${(parseFloat(finalJob.progress || '0') * 100).toFixed(0)}%`);
      console.log(`   Matches Found: ${finalJob.matchesFound || 0}`);
      console.log(`   Comments Transferred: ${finalJob.commentsTransferred || 0}`);
      console.log(`   Message: ${finalJob.message || 'N/A'}`);
      
      if (finalJob.errorMessage) {
        console.log(`   ⚠️  Error: ${finalJob.errorMessage}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    
    if (result.success) {
      console.log('✅ TEST PASSED!');
      console.log('\n💡 Next steps:');
      console.log('   1. Check Frame.io target file for transferred comments');
      console.log(`   2. View: https://app.frame.io/reviews/${TEST_DATA.targetFileId}`);
      console.log('   3. Verify comments appear at correct timestamps');
    } else {
      console.log('❌ TEST FAILED');
      console.log('\n🔍 Troubleshooting:');
      console.log('   1. Check Frame.io authentication (token expired?)');
      console.log('   2. Verify source file has comments');
      console.log('   3. Check video proxies are available');
      console.log('   4. Review error logs above');
    }
    
    console.log('='.repeat(80) + '\n');

    process.exit(result.success ? 0 : 1);

  } catch (error) {
    console.error('\n❌ TEST ERROR:', error);
    console.error('\nStack trace:', error instanceof Error ? error.stack : 'N/A');
    process.exit(1);
  }
}

// Run the test
console.log('\n🎬 Starting end-to-end test...\n');
testEndToEnd();
