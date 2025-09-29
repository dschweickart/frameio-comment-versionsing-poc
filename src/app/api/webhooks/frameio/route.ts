import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

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
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
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
    const webhookSecret = process.env.FRAMEIO_WEBHOOK_SECRET || '';
    
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
        console.log('📝 Form Data Received:', payload.data);
        
        // Process the form data and return success message
        return {
          title: "Success! 🎉",
          description: `Comment versioning initiated for ${payload.resource?.type} "${payload.data.target_version || 'selected asset'}". AI analysis in progress...`
        };
      }
      
      // Initial trigger - return form to collect user input
      return {
        title: "AI Comment Transfer",
        description: "Transfer comments from this video to another version using AI-powered visual matching.",
        fields: [
          {
            type: "text",
            label: "Target Version Name",
            name: "target_version",
            value: "v2_final.mp4"
          },
          {
            type: "select",
            label: "Matching Sensitivity",
            name: "sensitivity",
            value: "medium",
            options: [
              {
                name: "High (Strict matching)",
                value: "high"
              },
              {
                name: "Medium (Balanced)",
                value: "medium"
              },
              {
                name: "Low (Flexible matching)",
                value: "low"
              }
            ]
          },
          {
            type: "boolean",
            label: "Preview Before Transfer",
            name: "preview_mode",
            value: "true"
          },
          {
            type: "textarea",
            label: "Additional Notes",
            name: "notes",
            value: "AI-powered comment transfer between video versions"
          }
        ]
      };
      
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
