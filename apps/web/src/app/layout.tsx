'use client';

import './globals.css';
import { ReactNode, Suspense } from 'react';
import { ClerkProvider, SignInButton, SignUpButton, Show, UserButton } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';

function NavigationHeader() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');

  // If on admin routes, render clean admin header matching original simple design
  if (isAdmin) {
    return (
      <header className="h-12 min-h-[48px] border-b border-[#e5e9e2] bg-white px-4 sm:px-6 lg:px-8 shadow-[0_1px_2px_rgba(27,48,38,0.03)] flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <span className="font-bold text-base sm:text-lg tracking-tight text-[#1b3026]">EntangledEcho</span>
          <span className="text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-[#f0f4ee] text-[#285a49] border border-[#d8e2d4] tracking-wider">
            Admin
          </span>
        </div>
        <nav className="flex items-center space-x-4 text-xs font-mono text-[#748379]">
          <span>Control Panel</span>
        </nav>
      </header>
    );
  }

  const navLinks = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/recommendations', label: 'AI Recommendations' },
    { href: '/calendar', label: 'Calendar' },
    { href: '/notifications', label: 'Notifications' },
    { href: '/settings', label: 'Settings' },
  ];

  // Regular user app header with Clerk Auth
  return (
    <header className="h-12 min-h-[48px] border-b border-[#e5e9e2] bg-white px-4 sm:px-6 lg:px-8 shadow-[0_1px_2px_rgba(27,48,38,0.03)] flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2.5">
          <a
            href="/"
            className="font-bold text-base sm:text-lg tracking-tight text-[#1b3026] hover:text-[#285a49] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] rounded"
          >
            EntangledEcho
          </a>
          <span className="text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-[#f0f4ee] text-[#285a49] border border-[#d8e2d4] tracking-wider">
            Platform
          </span>
        </div>
        <nav className="hidden md:flex items-center space-x-1.5 text-xs">
          {navLinks.map((link) => {
            const isSelected = pathname === link.href;
            return (
              <a
                key={link.href}
                href={link.href}
                className={`transition-colors px-2.5 py-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                  isSelected
                    ? 'bg-[#eef6eb] text-[#1b3026] font-semibold border border-[#cbe2c5]'
                    : 'text-[#55635a] hover:text-[#1b3026] hover:bg-[#f5f8f3] border border-transparent'
                }`}
              >
                {link.label}
              </a>
            );
          })}
        </nav>
      </div>
      <nav className="flex items-center space-x-3 text-sm font-medium">
        <Suspense fallback={<div className="w-7 h-7 rounded-full bg-[#eef3ec] animate-pulse" />}>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="px-2.5 py-1 text-xs font-medium rounded-md border border-[#d8e0d5] text-[#1b3026] bg-white hover:bg-[#f5f8f3] hover:border-[#1b3026] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]">
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="px-2.5 py-1 text-xs font-semibold rounded-md bg-[#20372d] text-white border border-[#20372d] hover:bg-white hover:text-[#20372d] hover:border-[#20372d] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]">
                Sign Up
              </button>
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
        <body className="min-h-screen bg-[#fbfaf8] text-[#1b3026] antialiased">
          {!isLandingPage && !isAuthPage && <NavigationHeader />}
          {isLandingPage || isAuthPage ? (
            <main className="min-h-screen w-full">{children}</main>
          ) : (
            <main className="w-full">{children}</main>
          )}
        </body>
      </html>
    </ClerkProvider>
  );
}
