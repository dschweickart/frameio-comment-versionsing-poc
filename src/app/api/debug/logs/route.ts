import { NextResponse } from 'next/server';

// Simple in-memory log store (resets on deployment)
let logs: Array<{ timestamp: string; message: string; data?: unknown }> = [];

export async function GET() {
  return NextResponse.json({
    logs: logs.slice(-50), // Last 50 logs
    count: logs.length,
    message: 'Recent webhook activity'
  });
}

export async function POST(request: Request) {
  try {
    const { message, data } = await request.json();
    
    logs.push({
      timestamp: new Date().toISOString(),
      message,
      data
    });
    
    // Keep only last 100 logs
    if (logs.length > 100) {
      logs = logs.slice(-100);
    }
    
    return NextResponse.json({ success: true, logged: true });
  } catch {
    return NextResponse.json({ error: 'Failed to log' }, { status: 500 });
  }
}

export async function DELETE() {
  logs = [];
  return NextResponse.json({ success: true, message: 'Logs cleared' });
}

