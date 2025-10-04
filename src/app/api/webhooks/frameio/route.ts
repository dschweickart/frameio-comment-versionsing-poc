import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { FrameioClient } from '@/lib/frameio-client';
import { db, processingJobs, NewProcessingJob } from '@/lib/db';
import { processJob } from '@/lib/video/process-job';

interface FrameioWebhookPayload {
  event?: string;
  type?: string; // Frame.io sends "type" for Custom Actions
  timestamp: string;
  resource: {
    type: string;
    id: string;
    [key: string]: unknown;
  };
  user: {
    id: string;
    name?: string;
    email?: string;
  };
  account?: {
    id: string;
    name: string;
  };
  account_id?: string;
  interaction_id?: string;
  action_id?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface FormCallbackResponse {
  title: string;
  description: string;
  fields?: FormField[];
}

interface MessageCallbackResponse {
  title: string;
  description: string;
}

interface FormField {
  type: 'text' | 'textarea' | 'select' | 'boolean' | 'link';
  label: string;
  name: string;
  value: string;
  options?: { name: string; value: string }[];
}

/**
 * Truncate filename in the middle for display
 * @param filename - Full filename
 * @param maxLength - Maximum length (default: 40)
 * @returns Truncated filename with ellipsis in the middle
 */
function truncateMiddle(filename: string, maxLength: number = 40): string {
  if (filename.length <= maxLength) return filename;
  
  const extensionMatch = filename.match(/\.[^.]+$/);
  const extension = extensionMatch ? extensionMatch[0] : '';
  const nameWithoutExt = extension ? filename.slice(0, -extension.length) : filename;
  
  const charsToShow = maxLength - extension.length - 3; // -3 for "..."
  const startChars = Math.ceil(charsToShow / 2);
  const endChars = Math.floor(charsToShow / 2);
  
  return nameWithoutExt.slice(0, startChars) + '...' + nameWithoutExt.slice(-endChars) + extension;
}

/**
 * Verify Frame.io Custom Action webhook signature
 * 
 * Per Frame.io docs: https://developer.adobe.com/frameio/guides/Custom%20Actions/Configuring%20Actions/
 * 1. Message to sign: `v0:timestamp:body`
 * 2. Signature format: `v0={HMAC-SHA256(secret, message)}`
 * 3. Timestamp must be within 5 minutes to prevent replay attacks
 */
function verifyWebhookSignature(
  payload: string, 
  signature: string, 
  timestamp: string, 
  secret: string
): boolean {
  if (!signature || !secret || !timestamp) {
    console.warn('Missing signature, secret, or timestamp for verification');
    return false;
  }
  
  try {
    // 1. Verify timestamp is within 5 minutes (300 seconds) to prevent replay attacks
    const requestTime = parseInt(timestamp);
    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(currentTime - requestTime);
    
    if (timeDiff > 300) {
      console.warn(`Webhook timestamp too old: ${timeDiff}s ago (max 300s)`);
      return false;
    }
    
    // 2. Extract the hash from the signature (format: "v0=<hash>")
    if (!signature.startsWith('v0=')) {
      console.warn('Webhook signature missing v0= prefix');
      return false;
    }
    const receivedHash = signature.substring(3); // Remove "v0=" prefix
    
    // 3. Construct the message as per Frame.io spec: "v0:timestamp:body"
    const message = `v0:${timestamp}:${payload}`;
    
    // 4. Calculate expected signature
    const expectedHash = crypto
      .createHmac('sha256', secret)
      .update(message)
      .digest('hex');
    
    // 5. Compare using timing-safe comparison
    const receivedBuffer = Buffer.from(receivedHash);
    const expectedBuffer = Buffer.from(expectedHash);
    
    if (receivedBuffer.length !== expectedBuffer.length) {
      console.warn(`Hash length mismatch: got ${receivedBuffer.length}, expected ${expectedBuffer.length}`);
      return false;
    }
    
    const isValid = crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
    
    if (!isValid) {
      console.warn('Signature verification failed - hash mismatch');
    }
    
    return isValid;
  } catch (error) {
    console.error('Webhook signature verification error:', error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get request body and headers
    const body = await request.text();
    const signature = request.headers.get('x-frameio-signature') || '';
    const timestamp = request.headers.get('x-frameio-request-timestamp') || '';
    const webhookSecret = process.env.FRAMEIO_WEBHOOK_SECRET || process.env.ACTION_SECRET || '';
    
    // Minimal signature verification logging
    if (!webhookSecret || !signature || !timestamp) {
      console.log('⚠️  Webhook signature verification skipped (missing credentials)');
    }
    
    // Verify webhook signature if secret is configured (currently optional for POC)
    // TODO: For production, make this required and implement multi-tenant secret storage
    let isVerified = false;
    if (webhookSecret && signature && timestamp) {
      isVerified = verifyWebhookSignature(body, signature, timestamp, webhookSecret);
      if (!isVerified) {
        console.warn('⚠️  Signature verification failed - processing anyway (POC mode)');
        // For production, uncomment this to reject invalid signatures:
        // return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }
    
    // Parse the payload
    const payload: FrameioWebhookPayload = JSON.parse(body);
    
    // Console log the webhook for debugging
    const eventType = payload.type || payload.event; // Frame.io sends "type" for Custom Actions
    console.log(`🎯 Webhook: ${eventType} | ${payload.resource?.type}:${payload.resource?.id?.substring(0, 8)} | interaction:${payload.interaction_id?.substring(0, 8)}`);
    
    
    // Handle different webhook events
    const response = await handleWebhookEvent(payload);
    
    // If handler returns a response (form or message), send it back
    if (response) {
      return NextResponse.json(response);
    }
    
    // Default success response
    return NextResponse.json({ 
      success: true, 
      message: 'Webhook processed successfully'
    });
    
  } catch (error) {
    console.error('❌ WEBHOOK ERROR:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

async function handleWebhookEvent(payload: FrameioWebhookPayload): Promise<FormCallbackResponse | MessageCallbackResponse | null> {
  const eventType = payload.type || payload.event; // Frame.io sends "type" for Custom Actions
  switch (eventType) {
    case 'custom_action.triggered':
      
      // Check if this is a form submission (has data field)
      if (payload.data) {
        console.log('📝 Form Data Received:', JSON.stringify(payload.data, null, 2));
        console.log('📋 Form fields:', Object.keys(payload.data));
        
        // If this is just the confirmation step (no source_file_id), proceed to version selection
        if (!payload.data.source_file_id) {
          console.log('✅ User confirmed, proceeding to version selection...');
          // Fall through to version selection logic below
        } else if (payload.data.source_file_id) {
          // This is the final submission with source file selected
          // Save processing job to database
        try {
          const accountId = payload.account?.id || payload.account_id;
          const sourceFileId = payload.data.source_file_id as string;
          
          // Fetch comments from source file before creating job
          // Use user_id instead of account_id (users can belong to multiple accounts)
          const userId = payload.user?.id;
          if (!userId) {
            return {
              title: "Authentication Error ❌",
              description: "User ID not found in webhook payload."
            };
          }
          
          const client = await FrameioClient.fromUserId(userId);
          if (!client) {
            return {
              title: "Authentication Required ❌",
              description: "Please sign in to the application first, then try again."
            };
          }
          
          console.log(`🔍 Fetching comments from source file: ${sourceFileId}`);
          const sourceComments = await client.getFileComments(accountId!, sourceFileId);
          
          if (!sourceComments || sourceComments.length === 0) {
            console.log('❌ No comments found on source file');
            return {
              title: "No Comments Found ❌",
              description: "The source file has no comments to transfer. Please add comments to the source file first, then try again."
            };
          }
          
          console.log(`✅ Found ${sourceComments.length} comments on source file`);
          
          // Fetch file names for metadata and success message
          let sourceFileName = 'selected source';
          let targetFileName = 'target file';
          
          try {
            if (accountId && payload.resource?.id) {
              const [sourceFile, targetFile] = await Promise.all([
                client.getFile(accountId, sourceFileId),
                client.getFile(accountId, payload.resource.id)
              ]);
              sourceFileName = sourceFile.name || sourceFileName;
              targetFileName = targetFile.name || targetFileName;
            }
          } catch {
            console.log('⚠️  Could not fetch file names, using defaults');
          }
          
          // Check for existing job with same interaction_id (idempotency for Frame.io retries)
          const existingJob = await db.query.processingJobs.findFirst({
            where: (jobs, { eq }) => eq(jobs.interactionId, payload.interaction_id!)
          });
          
          if (existingJob) {
            console.log(`⚠️  Duplicate request detected (interaction: ${payload.interaction_id?.substring(0, 8)}, status: ${existingJob.status})`);
            return {
              title: existingJob.status === 'completed' ? "Already Processed ✓" : "Processing... ⏳",
              description: existingJob.status === 'completed' 
                ? "This request has already been completed."
                : "Your request is already being processed. Please wait."
            };
          }
          
          const newJob: NewProcessingJob = {
            accountId,
            projectId: (payload.resource as { project_id?: string })?.project_id,
            versionStackId: null, // Not storing version stack ID anymore
            sourceFileId,
            targetFileId: payload.resource?.id,
            interactionId: payload.interaction_id,
            userId: payload.user?.id,
            userName: payload.user?.name,
            userEmail: payload.user?.email,
            status: 'pending',
            metadata: JSON.stringify({
              sensitivity: 'medium', // 80% similarity threshold (default)
              sourceFileName,
              targetFileName,
              sourceCommentsCount: sourceComments.length,
              sourceCommentIds: sourceComments.map(c => c.id),
              triggeredAt: new Date().toISOString(),
            }),
          };
          
          const [job] = await db.insert(processingJobs).values(newJob).returning();
          
          console.log(`\n${'='.repeat(80)}`);
          console.log(`📝 JOB SUBMITTED: ${job.id.substring(0, 8)}`);
          console.log(`   Source: ${sourceFileName}`);
          console.log(`   Target: ${targetFileName}`);
          console.log(`   Comments: ${sourceComments.length}`);
          console.log(`   Interaction: ${payload.interaction_id?.substring(0, 8)}`);
          console.log(`${'='.repeat(80)}\n`);
          
          // Trigger job processing asynchronously (don't await - let it run in background)
          processJob(job.id).catch((error) => {
            console.error(`❌ Job ${job.id.substring(0, 8)} processing failed:`, error);
          });
          
          return {
            title: "Success! 🎉",
            description: "Matching comment job submitted..."
          };
        } catch (error) {
          console.error('❌ Failed to create processing job:', error);
          return {
            title: "Error ❌",
            description: `Failed to initiate processing: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
        }
      }
      
      // Fetch version stack and return version selection form immediately
      try {
        const accountId = payload.account?.id || payload.account_id;
        const fileId = payload.resource?.id;
        
        if (!accountId || !fileId) {
          return {
            title: "Error ❌",
            description: "Missing required data (account_id or file_id). Please try again."
          };
        }
        
        // Initial request - fetch version stack and show form
        // Use user_id instead of account_id (users can belong to multiple accounts)
        const userId = payload.user?.id;
        if (!userId) {
          return {
            title: "Error ❌",
            description: "User ID not found in webhook payload."
          };
        }
        
        const client = await FrameioClient.fromUserId(userId);
        if (!client) {
          return {
            title: "Authentication Required ❌",
            description: "Please sign in to the application first, then try again."
          };
        }
        
        // Get file details
        const file = await client.getFile(accountId, fileId);
        
        if (!file.parent_id) {
          return {
            title: "Not in Version Stack ❌",
            description: `The file "${file.name}" is not part of a version stack. Please add it to a version stack first.`
          };
        }
        
        // List version stack children (siblings)
        const allVersions = await client.listVersionStackChildren(accountId, file.parent_id);
        
        // Filter out the target file to get source options
        const sourceFiles = allVersions.filter(v => v.id !== fileId && v.status === 'transcoded');
        
        if (sourceFiles.length === 0) {
          return {
            title: "No Other Versions ❌",
            description: `No other transcoded versions found in this version stack. You need at least 2 versions to transfer comments.`
          };
        }
        
        // Build form with dynamic source file options
        return {
          title: `Apply comments to "${file.name}"`,
          description: "",
          fields: [
            {
              type: "select",
              label: "Select source",
              name: "source_file_id",
              value: sourceFiles[0].id,
              options: sourceFiles.map((sf, index) => ({
                name: `v${index + 1} - ${truncateMiddle(sf.name)}`,
                value: sf.id
              }))
            }
          ]
        };
        
      } catch (error) {
        console.error('❌ Custom action failed:', error);
        return {
          title: "Error ❌",
          description: `Failed to load version stack: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
      }
      
    case 'asset.created':
      console.log('📁 Asset Created:', {
        assetId: payload.resource?.id,
        assetType: payload.resource?.type,
      });
      break;
      
    case 'comment.created':
      console.log('💬 Comment Created:', {
        commentId: payload.resource?.id,
        assetId: (payload.resource as { asset_id?: string })?.asset_id,
      });
      break;
      
    default:
      console.log('📋 Other Event:', eventType);
  }
  
  return null;
}

// GET endpoint for webhook status
export async function GET() {
  return NextResponse.json({
    status: 'active',
    endpoint: '/api/webhooks/frameio',
    message: 'Frame.io webhook endpoint ready',
    timestamp: new Date().toISOString(),
  });
}
