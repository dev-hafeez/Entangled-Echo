'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { UserButton, SignInButton, Show } from '@clerk/nextjs';
import {
  Bell,
  Search,
  Plus,
  Sparkles,
  Calendar,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';

interface AppTopBarProps {
  activeHandle?: string;
  unreadCount?: number;
  onSwitchAccount?: (handle: string) => void;
}

export function AppTopBar({
  activeHandle = '',
  unreadCount = 0,
  onSwitchAccount,
}: AppTopBarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [handle, setHandle] = useState(activeHandle);

  useEffect(() => {
    if (activeHandle) setHandle(activeHandle);
  }, [activeHandle]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = searchInput.trim().toLowerCase().replace(/^@/, '');
    if (!clean) return;
    if (onSwitchAccount) {
      onSwitchAccount(clean);
    } else {
      localStorage.setItem('ee_active_handle', clean);
      router.push(`/dashboard`);
    }
    setSearchOpen(false);
    setSearchInput('');
  };

  const getPageTitle = () => {
    if (pathname === '/dashboard') return 'Creator Dashboard';
    if (pathname === '/recommendations') return 'AI Strategy & Recommendations';
    if (pathname === '/calendar') return 'Schedule & Publication Calendar';
    if (pathname === '/notifications') return 'Notifications & Alerts';
    if (pathname === '/settings') return 'Settings & Accounts';
    if (pathname?.startsWith('/admin')) return 'Administration Console';
    return 'EntangledEcho';
  };

  return (
    <header className="h-16 border-b border-stone-200 bg-white sticky top-0 z-20 flex items-center justify-between px-6">
      {/* Left: Breadcrumb / Page Title */}
      <div className="flex items-center space-x-3">
        <h1 className="text-base font-bold text-stone-900 tracking-tight">
          {getPageTitle()}
        </h1>
        {handle && (
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono bg-stone-100 text-stone-700 border border-stone-200">
            @{handle.replace(/^@/, '')}
          </span>
        )}
      </div>

      {/* Right: Actions, Notifications & Clerk Auth */}
      <div className="flex items-center space-x-3">
        {/* Quick Switch Handle Form */}
        <form onSubmit={handleSearchSubmit} className="relative hidden lg:block">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search creator handle..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-48 xl:w-64 pl-8 pr-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-stone-50/60 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-stone-900 focus:border-stone-900 transition font-sans text-stone-900 placeholder:text-stone-400"
            />
          </div>
        </form>

        {/* Primary Action Button (Black border; on hover black background with white text per owner preference) */}
        <Link
          href="/calendar"
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-black bg-white text-black hover:bg-black hover:text-white transition-colors duration-150 flex items-center space-x-1.5 shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Schedule Post</span>
        </Link>

        {/* AI Recommendations Shortcut */}
        <Link
          href="/recommendations"
          className="hidden sm:flex text-xs font-semibold px-3 py-1.5 rounded-lg border border-stone-300 bg-stone-50 hover:bg-stone-100 text-stone-800 transition items-center space-x-1.5 shadow-xs"
          title="Explore AI recommendations"
        >
          <Sparkles className="w-3.5 h-3.5 text-stone-700" />
          <span>Insights</span>
        </Link>

        {/* Notification Bell */}
        <Link
          href="/notifications"
          className="relative p-2 rounded-lg text-stone-600 hover:text-stone-900 hover:bg-stone-100 transition border border-stone-200"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white shadow-xs">
              {unreadCount}
            </span>
          )}
        </Link>

        {/* Clerk Auth Avatar */}
        <div className="flex items-center pl-1 border-l border-stone-200">
          <Show when="signed-in">
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="text-xs font-medium px-3 py-1.5 rounded-md border border-stone-300 hover:bg-stone-100 transition text-stone-800">
                Sign In
              </button>
            </SignInButton>
          </Show>
        </div>
      </div>
    </header>
  );
}
