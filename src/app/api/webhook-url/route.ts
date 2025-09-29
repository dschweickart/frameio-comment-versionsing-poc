import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const webhookUrl = `${request.nextUrl.origin}/api/webhooks/frameio`;
  
  return NextResponse.json({
    webhook_url: webhookUrl,
    message: 'Current webhook URL for Frame.io Custom Actions',
    instructions: {
      step1: 'Copy the webhook_url above',
      step2: 'Go to Frame.io → Settings → Custom Actions',
      step3: 'Create a new Custom Action',
      step4: 'Paste the webhook URL in the URL field',
      step5: 'Test the action on a video file'
    }
  });
}

