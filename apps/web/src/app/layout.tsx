'use client';

import './globals.css';
import { ReactNode, Suspense } from 'react';
import { ClerkProvider, SignInButton, SignUpButton, Show, UserButton } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';

function NavigationHeader() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');

  // If on admin routes, render clean admin header matching original simple design
  if (isAdmin) {
    return (
      <header className="border-b bg-white px-4 sm:px-6 lg:px-8 py-3.5 shadow-sm flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <span className="font-bold text-xl tracking-tight text-slate-800">EntangledEcho</span>
          <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">Admin</span>
        </div>
        <nav className="flex items-center space-x-4 text-sm font-medium">
          <span className="text-xs font-mono text-slate-400">Control Panel</span>
        </nav>
      </header>
    );
  }

  // Regular user app header with Clerk Auth
  return (
    <header className="border-b bg-white px-4 sm:px-6 lg:px-8 py-3.5 shadow-sm flex items-center justify-between">
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-3">
          <a href="/dashboard" className="font-bold text-xl tracking-tight text-slate-800">EntangledEcho</a>
          <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">Platform</span>
        </div>
        <nav className="hidden md:flex items-center space-x-4 text-xs font-semibold">
          <a
            href="/dashboard"
            className={`transition px-2.5 py-1 rounded-md ${
              pathname === '/dashboard'
                ? 'bg-slate-100 text-slate-900 font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Dashboard
          </a>
          <a
            href="/recommendations"
            className={`transition px-2.5 py-1 rounded-md flex items-center gap-1.5 ${
              pathname === '/recommendations'
                ? 'bg-purple-50 text-purple-700 border border-purple-200 font-bold'
                : 'text-slate-600 hover:text-purple-600'
            }`}
          >
            <span>AI Recommendations</span>
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
          </a>
          <a
            href="/calendar"
            className={`transition px-2.5 py-1 rounded-md flex items-center gap-1.5 ${
              pathname === '/calendar'
                ? 'bg-slate-100 text-slate-900 font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Calendar</span>
          </a>
          <a
            href="/notifications"
            className={`transition px-2.5 py-1 rounded-md flex items-center gap-1.5 ${
              pathname === '/notifications'
                ? 'bg-slate-100 text-slate-900 font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Notifications</span>
          </a>
          <a
            href="/settings"
            className={`transition px-2.5 py-1 rounded-md flex items-center gap-1.5 ${
              pathname === '/settings'
                ? 'bg-slate-100 text-slate-900 font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Settings</span>
          </a>
        </nav>
      </div>
      <nav className="flex items-center space-x-3 text-sm font-medium">
        <Suspense fallback={<div className="w-8 h-8 rounded-full bg-slate-200 animate-pulse" />}>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <Button size="sm">
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button size="sm">
                Sign Up
              </Button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </Suspense>
      </nav>
    </header>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLandingPage = pathname === '/';
  const isAuthPage = pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up') || pathname?.startsWith('/login') || pathname?.startsWith('/signup');

  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen bg-white text-slate-900 antialiased">
          {!isLandingPage && !isAuthPage && <NavigationHeader />}
          {isLandingPage || isAuthPage ? (
            <main className="min-h-screen w-full">{children}</main>
          ) : (
            <main className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full">{children}</main>
          )}
        </body>
      </html>
    </ClerkProvider>
  );
}
