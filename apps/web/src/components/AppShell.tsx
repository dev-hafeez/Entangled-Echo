'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { AppSidebar } from './AppSidebar';
import { AppTopBar } from './AppTopBar';
import { api } from '@/lib/api';
import { useUser } from '@clerk/nextjs';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useUser();

  const isLandingPage = pathname === '/';
  const isAuthPage =
    pathname?.startsWith('/sign-in') ||
    pathname?.startsWith('/sign-up') ||
    pathname?.startsWith('/login') ||
    pathname?.startsWith('/signup');
  const isAdmin = pathname?.startsWith('/admin');

  const [activeHandle, setActiveHandle] = useState<string>('');
  const [unreadCount, setUnreadCount] = useState<number>(0);

  useEffect(() => {
    // Resolve active creator handle from local state
    const stored = localStorage.getItem('ee_active_handle') || 'tahirabbas_ca';
    setActiveHandle(stored);

    // Fetch unread count for notifications bell
    if (user?.id) {
      api.getNotifications(user.id).then((res) => {
        if (res?.unreadCount !== undefined) setUnreadCount(res.unreadCount);
      }).catch(() => {});
    }
  }, [user]);

  // Landing page or Auth pages: render full-screen canvas
  if (isLandingPage || isAuthPage) {
    return <>{children}</>;
  }

  // Admin routes: dedicated minimal admin layout
  if (isAdmin) {
    return (
      <div className="min-h-screen bg-stone-50 text-stone-900">
        <header className="border-b border-stone-200 bg-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <a href="/dashboard" className="font-bold text-lg text-stone-900 tracking-tight">
              EntangledEcho
            </a>
            <span className="text-[11px] bg-stone-200 text-stone-800 px-2 py-0.5 rounded font-mono font-medium">
              Admin Console
            </span>
          </div>
          <a
            href="/dashboard"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-black bg-white text-black hover:bg-black hover:text-white transition"
          >
            ← Back to App
          </a>
        </header>
        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </div>
    );
  }

  // Main App Layout with Sidebar & TopBar
  return (
    <div className="min-h-screen bg-[#FAFAFA] text-stone-900">
      <AppSidebar activeHandle={activeHandle} unreadCount={unreadCount} />
      <div className="md:pl-64 flex flex-col min-h-screen">
        <AppTopBar activeHandle={activeHandle} unreadCount={unreadCount} />
        <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
