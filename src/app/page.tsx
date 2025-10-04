'use client';

import { useAuth } from '@/lib/auth/context';
import { LoginButton } from '@/components/auth/LoginButton';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';

interface User {
  id: string;
  name: string;
  email: string;
  avatar_url?: string;
}

function AuthMessage() {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const error = searchParams.get('error');
    const auth = searchParams.get('auth');

    if (error) {
      setMessage(`Authentication error: ${decodeURIComponent(error)}`);
    } else if (auth === 'success') {
      setMessage('Successfully authenticated with Frame.io!');
    }
  }, [searchParams]);

  if (message) {
    return (
      <div className={`p-4 rounded-md mb-6 ${
        message.includes('error') 
          ? 'bg-red-50 border border-red-200 text-red-700'
          : 'bg-green-50 border border-green-200 text-green-700'
      }`}>
        {message}
      </div>
    );
  }

  return null;
}

export default function Home() {
  const { user, loading } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">
                Frame.io Comment Versioning POC
              </h1>
            </div>
            <LoginButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Status Messages */}
        <Suspense fallback={<div>Loading...</div>}>
          <AuthMessage />
        </Suspense>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : user ? (
          <AuthenticatedView user={user} />
        ) : (
          <UnauthenticatedView />
        )}
      </main>
    </div>
  );
}

function UnauthenticatedView() {
  return (
    <div className="max-w-2xl mx-auto text-center py-20">
      <h2 className="text-4xl font-bold text-gray-900 mb-4">
        Frame.io Comment Versioning
      </h2>
      <p className="text-xl text-gray-600 mb-8">
        Automatically transfer comments between video versions using perceptual hashing to match frames.
      </p>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-left">
        <h3 className="font-semibold text-blue-900 mb-3">How it works:</h3>
        <ol className="space-y-2 text-blue-800">
          <li><strong>1.</strong> Sign in with Frame.io</li>
          <li><strong>2.</strong> Configure the webhook URL in your Custom Action</li>
          <li><strong>3.</strong> Trigger the action on any file in a version stack</li>
          <li><strong>4.</strong> Comments are automatically matched and transferred</li>
        </ol>
      </div>
    </div>
  );
}

interface Job {
  id: string;
  status: string;
  progress: number;
  progressPercent: number;
  message: string | null;
  errorMessage: string | null;
  sourceFileName: string;
  targetFileName: string;
  commentsCount: number;
  matchesFound: number;
  commentsTransferred: number;
  createdAt: Date | null;
  completedAt: Date | null;
  duration: string | null;
  accountId: string | null;
  projectId: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AuthenticatedView({ user }: { user: User }) {
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  useEffect(() => {
    // Get the current webhook URL dynamically
    if (typeof window !== 'undefined') {
      setWebhookUrl(`${window.location.origin}/api/webhooks/frameio`);
    }
  }, []);

  useEffect(() => {
    // Fetch jobs for this user
    const fetchJobs = async () => {
      try {
        const response = await fetch('/api/jobs');
        if (response.ok) {
          const data = await response.json();
          setJobs(data.jobs);
        }
      } catch (error) {
        console.error('Failed to fetch jobs:', error);
      } finally {
        setLoadingJobs(false);
      }
    };

    fetchJobs();
    // Refresh every 10 seconds
    const interval = setInterval(fetchJobs, 10000);
    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = (status: string) => {
    const badges: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-800',
      processing: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      completed_with_errors: 'bg-yellow-100 text-yellow-800',
      failed: 'bg-red-100 text-red-800',
    };
    return badges[status] || 'bg-gray-100 text-gray-800';
  };

  const formatDate = (date: Date | null | string) => {
    if (!date) return 'N/A';
    const d = new Date(date);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Webhook URL Card */}
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">🔗 Webhook URL</h3>
        <div className="flex items-center gap-3">
          <code className="flex-1 bg-gray-50 rounded-lg border border-gray-200 px-4 py-3 text-sm font-mono text-gray-800 break-all">
            {webhookUrl || 'Loading...'}
          </code>
          <button
            onClick={() => {
              if (webhookUrl) {
                navigator.clipboard.writeText(webhookUrl);
                alert('Webhook URL copied to clipboard!');
              }
            }}
            disabled={!webhookUrl}
            className="inline-flex items-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            📋 Copy
          </button>
        </div>
      </div>

      {/* Job History Table */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Job History</h3>
        </div>
        
        {loadingJobs ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No jobs yet. Trigger a comment transfer from Frame.io to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Source → Target
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Progress
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Results
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(job.status)}`}>
                        {job.status === 'processing' && (
                          <svg className="animate-spin -ml-0.5 mr-1.5 h-3 w-3" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        )}
                        {job.status}
                      </span>
                      {job.errorMessage && (
                        <div className="text-xs text-red-600 mt-1 max-w-xs truncate" title={job.errorMessage}>
                          {job.errorMessage}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 font-medium truncate max-w-xs" title={job.sourceFileName}>
                        {job.sourceFileName}
                      </div>
                      <div className="text-xs text-gray-500">→</div>
                      <div className="text-sm text-gray-600 truncate max-w-xs" title={job.targetFileName}>
                        {job.targetFileName}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {job.status === 'processing' ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                              <div 
                                className="bg-blue-600 h-2 transition-all duration-300"
                                style={{ width: `${job.progressPercent}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-600 font-medium">{job.progressPercent}%</span>
                          </div>
                          {job.message && (
                            <div className="text-xs text-gray-500 truncate max-w-xs" title={job.message}>
                              {job.message}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500">
                          {job.commentsCount} comments
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {job.status === 'completed' || job.status === 'completed_with_errors' ? (
                        <div className="text-sm">
                          <div className="text-green-600 font-medium">{job.commentsTransferred} transferred</div>
                          {job.matchesFound > 0 && job.matchesFound !== job.commentsTransferred && (
                            <div className="text-xs text-gray-500">{job.matchesFound} matches</div>
                          )}
                        </div>
                      ) : job.status === 'failed' ? (
                        <span className="text-sm text-red-600">Failed</span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">
                        {formatDate(job.createdAt)}
                      </div>
                      {job.duration && (
                        <div className="text-xs text-gray-400">
                          {job.duration}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}