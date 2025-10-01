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

function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  if (!signature || !secret) {
    return false;
  }
  
  try {
    // Frame.io uses HMAC-SHA256 with the format "sha256=<hash>"
    const expectedSignature = `sha256=${crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex')}`;
    
    // Convert to buffers
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    
    // timingSafeEqual requires buffers of equal length
    if (sigBuffer.length !== expectedBuffer.length) {
      console.warn(`Webhook signature length mismatch: got ${sigBuffer.length}, expected ${expectedBuffer.length}`);
      return false;
    }
    
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
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
    const webhookSecret = process.env.FRAMEIO_WEBHOOK_SECRET || process.env.ACTION_SECRET || '';
    
    // Debug logging for signature verification
    console.log('🔐 Webhook signature debug:', {
      hasSignature: !!signature,
      signatureLength: signature.length,
      hasSecret: !!webhookSecret,
      secretLength: webhookSecret.length,
      signaturePreview: signature.substring(0, 20) + '...',
    });
    
    // Verify webhook signature if secret is configured
    const isVerified = webhookSecret ? verifyWebhookSignature(body, signature, webhookSecret) : true;
    
    if (webhookSecret && !isVerified) {
      console.error('❌ Webhook signature verification failed');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    
    // Parse the payload
    const payload: FrameioWebhookPayload = JSON.parse(body);
    
    // Console log the webhook for debugging
    const eventType = payload.type || payload.event; // Frame.io sends "type" for Custom Actions
    const logData = {
      event: eventType,
      resourceType: payload.resource?.type,
      resourceId: payload.resource?.id,
      userId: payload.user?.id,
      userName: payload.user?.name,
      accountId: payload.account?.id || payload.account_id,
      accountName: payload.account?.name,
      verified: isVerified,
      timestamp: new Date().toISOString(),
      fullPayload: payload, // Full payload for debugging
    };
    
    console.log('🎯 FRAME.IO WEBHOOK RECEIVED:', logData);
    console.error('🎯 WEBHOOK DEBUG (using error level):', logData); // Try error level
    
    // Also log to our debug endpoint
    try {
      await fetch(`${request.nextUrl.origin}/api/debug/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '🎯 FRAME.IO WEBHOOK RECEIVED',
          data: logData
        })
      });
    } catch {
      // Silent fail for debug logging
    }
    
    // Handle different webhook events
    const response = await handleWebhookEvent(payload);
    
    // If handler returns a response (form or message), send it back
    if (response) {
      console.log('📤 Sending response to Frame.io:', response);
      console.error('📤 RESPONSE DEBUG:', response); // Try error level
      
      // Add debug info to response
      return NextResponse.json({
        ...response,
        debug: {
          webhook_received: true,
          event: eventType,
          timestamp: new Date().toISOString(),
          logs_working: 'Console logs should appear in Vercel dashboard'
        }
      });
    }
    
    // Default success response
    return NextResponse.json({ 
      success: true, 
      message: 'Webhook processed successfully',
      event: eventType,
      timestamp: new Date().toISOString(),
      debug: {
        webhook_received: true,
        logs_working: 'Console logs should appear in Vercel dashboard'
      }
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
      const actionLog = {
        actionId: payload.resource?.id,
        resourceType: payload.resource?.type,
        user: payload.user?.name,
        interactionId: payload.interaction_id,
      };
      
      console.log('🚀 Custom Action Triggered:', actionLog);
      
      // Check if this is a form submission (has data field)
      if (payload.data) {
        console.log('📝 Form Data Received:', JSON.stringify(payload.data, null, 2));
        console.log('📋 Form fields:', Object.keys(payload.data));
        
        // Save processing job to database
        try {
          const accountId = payload.account?.id || payload.account_id;
          const sourceFileId = payload.data.source_file_id as string;
          
          // Fetch comments from source file before creating job
          const client = await FrameioClient.fromAccountId(accountId!);
          if (!client) {
            return {
              title: "Authentication Error ❌",
              description: "Could not authenticate with Frame.io. Please sign in again."
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
          
          const newJob: NewProcessingJob = {
            accountId,
            projectId: (payload.resource as { project_id?: string })?.project_id,
            versionStackId: payload.data.version_stack_id as string,
            sourceFileId,
            targetFileId: payload.resource?.id,
            interactionId: payload.interaction_id,
            userId: payload.user?.id,
            userName: payload.user?.name,
            userEmail: payload.user?.email,
            status: 'pending',
            metadata: JSON.stringify({
              sensitivity: payload.data.sensitivity,
              sourceFileName: payload.data.source_file_name,
              targetFileName: payload.data.target_file_name,
              sourceCommentsCount: sourceComments.length,
              sourceCommentIds: sourceComments.map(c => c.id),
              triggeredAt: new Date().toISOString(),
            }),
          };
          
          const [job] = await db.insert(processingJobs).values(newJob).returning();
          console.log(`✅ Processing job created: ${job.id} with ${sourceComments.length} comments to transfer`);
          
          // Trigger job processing asynchronously (don't await - let it run in background)
          processJob(job.id).catch((error) => {
            console.error(`❌ Job ${job.id} processing failed:`, error);
          });
          
          // Look up actual file names for better success message
          let sourceFileName = 'selected source';
          let targetFileName = 'target file';
          
          try {
            const client = await FrameioClient.fromAccountId(accountId!);
            if (client && accountId && payload.resource?.id) {
              const [sourceFile, targetFile] = await Promise.all([
                client.getFile(accountId, payload.data.source_file_id as string),
                client.getFile(accountId, payload.resource.id)
              ]);
              sourceFileName = sourceFile.name || sourceFileName;
              targetFileName = targetFile.name || targetFileName;
            }
          } catch {
            console.log('⚠️  Could not fetch file names for display, using defaults');
          }
          
          return {
            title: "Success! 🎉",
            description: `AI comment transfer initiated! Transferring ${sourceComments.length} comment${sourceComments.length === 1 ? '' : 's'} from "${sourceFileName}" to "${targetFileName}". Processing will begin shortly...`
          };
        } catch (error) {
          console.error('❌ Failed to create processing job:', error);
          return {
            title: "Error ❌",
            description: `Failed to initiate processing: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
      }
      
      // Initial trigger - validate version stack and return dynamic form
      try {
        const accountId = payload.account?.id || payload.account_id;
        const fileId = payload.resource?.id;
        
        console.log('🔍 Custom action debug:', {
          accountId,
          fileId,
          hasAccount: !!payload.account,
          accountIdDirect: payload.account_id,
          accountObject: payload.account
        });
        
        if (!accountId || !fileId) {
          return {
            title: "Error ❌",
            description: "Missing required data (account_id or file_id). Please try again."
          };
        }
        
        // Create Frame.io client from stored tokens
        console.log(`🔑 Looking for tokens with account_id: ${accountId}`);
        const client = await FrameioClient.fromAccountId(accountId);
        
        if (!client) {
          console.error(`❌ No tokens found for account_id: ${accountId}`);
          return {
            title: "Authentication Required ❌",
            description: `Please sign in to the application first. (Searched for account: ${accountId})`
          };
        }
        
        console.log('✅ Client created successfully from stored tokens');
        
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
          title: "AI Comment Transfer",
          description: `Transfer comments to "${file.name}" from another version in the stack.`,
          fields: [
            {
              type: "text",
              label: "Target File (current)",
              name: "target_file_name",
              value: file.name
            },
            {
              type: "select",
              label: "Source File (copy comments from)",
              name: "source_file_id",
              value: sourceFiles[0].id,
              options: sourceFiles.map(sf => ({
                name: `${sf.name} (${((sf.file_size || 0) / 1024 / 1024).toFixed(1)} MB)`,
                value: sf.id
              }))
            },
            {
              type: "text",
              label: "Version Stack ID (hidden)",
              name: "version_stack_id",
              value: file.parent_id
            },
            {
              type: "text",
              label: "Source File Name (hidden)",
              name: "source_file_name",
              value: sourceFiles[0].name
            },
            {
              type: "select",
              label: "Matching Sensitivity",
              name: "sensitivity",
              value: "medium",
              options: [
                { name: "High (Strict matching)", value: "high" },
                { name: "Medium (Balanced)", value: "medium" },
                { name: "Low (Flexible matching)", value: "low" }
              ]
            }
          ]
        };
        
      } catch (error) {
        console.error('❌ Version stack validation failed:', error);
        return {
          title: "Error ❌",
          description: `Failed to validate version stack: ${error instanceof Error ? error.message : 'Unknown error'}`
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
