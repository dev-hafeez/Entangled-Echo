'use client';

import './globals.css';
import { ReactNode, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { ClerkProvider, SignInButton, SignUpButton, Show, UserButton, useAuth } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import { setClerkTokenGetter } from '@/lib/api';
import { Menu, X } from 'lucide-react';

function ClerkTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setClerkTokenGetter(() => getToken());
  }, [getToken]);
  return null;
}

function NavigationHeader() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Recommendations', href: '/recommendations' },
    { label: 'Calendar', href: '/calendar' },
    { label: 'Notifications', href: '/notifications' },
    { label: 'Settings', href: '/settings' },
    { label: 'Admin', href: '/admin' },
  ];

  return (
    <header className="border-b border-neutral-200 bg-white sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Brand & Desktop Navigation */}
        <div className="flex items-center space-x-8">
          <Link
            href="/dashboard"
            className="text-base font-semibold tracking-tight text-[#373E3E] hover:text-black transition"
          >
            EntangledEcho
          </Link>

          <nav className="hidden md:flex items-center space-x-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href || (link.href !== '/dashboard' && pathname?.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-xs px-3 py-1.5 rounded transition ${
                    isActive
                      ? 'font-semibold text-black bg-neutral-100'
                      : 'text-neutral-500 hover:text-black hover:bg-neutral-50'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Actions & Auth */}
        <div className="flex items-center space-x-3">
          <Suspense fallback={<div className="w-7 h-7 rounded-full bg-neutral-100 animate-pulse" />}>
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="text-xs font-medium px-3 py-1.5 border border-black text-black bg-white hover:bg-black hover:text-white transition">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="text-xs font-medium px-3 py-1.5 bg-black text-white hover:bg-neutral-800 transition">
                  Sign Up
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <UserButton />
            </Show>
          </Suspense>

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 text-neutral-600 hover:text-black md:hidden"
            aria-label="Toggle Navigation Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Dropdown Menu */}
      {mobileMenuOpen && (
        <div className="border-t border-neutral-100 bg-white px-6 py-3 space-y-1 md:hidden">
          {navLinks.map((link) => {
            const isActive = pathname === link.href || (link.href !== '/dashboard' && pathname?.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`block text-xs py-2 px-3 rounded transition ${
                  isActive
                    ? 'font-semibold text-black bg-neutral-100'
                    : 'text-neutral-600 hover:text-black hover:bg-neutral-50'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuthPage =
    pathname?.startsWith('/sign-in') ||
    pathname?.startsWith('/sign-up') ||
    pathname?.startsWith('/login') ||
    pathname?.startsWith('/signup');

  return (
    <ClerkProvider>
      <ClerkTokenBridge />
      <html lang="en">
        <body className="min-h-screen bg-white text-neutral-900 antialiased font-sans">
          {!isAuthPage && <NavigationHeader />}
          <main className={isAuthPage ? 'min-h-screen w-full' : 'max-w-7xl mx-auto px-6 py-8'}>
            {children}
          </main>
        </body>
      </html>
    </ClerkProvider>
  );
}
