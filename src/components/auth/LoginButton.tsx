'use client';

import { useAuth } from '@/lib/auth/context';
import Image from 'next/image';

export function LoginButton() {
  const { user, loading, login, logout } = useAuth();

  if (loading) {
    return (
      <div className="animate-pulse bg-gray-200 h-10 w-24 rounded-md"></div>
    );
  }

  if (user) {
    return (
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          {user.avatar_url && (
            <Image 
              src={user.avatar_url} 
              alt={user.name}
              width={32}
              height={32}
              className="rounded-full border-2 border-gray-200"
            />
          )}
          <div className="text-sm">
            <div className="font-medium text-gray-900">{user.name}</div>
            <div className="text-gray-500">{user.email}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={login}
      className="flex items-center gap-2 px-6 py-3 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
    >
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
      Sign in with Frame.io
    </button>
  );
}
