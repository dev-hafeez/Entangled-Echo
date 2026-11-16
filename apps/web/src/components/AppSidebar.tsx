'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Sparkles,
  Calendar,
  Bell,
  Settings,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
  Instagram,
  Facebook,
  Menu,
  X,
  Radio,
} from 'lucide-react';

interface AppSidebarProps {
  activeHandle?: string;
  unreadCount?: number;
}

export function AppSidebar({ activeHandle = '', unreadCount = 0 }: AppSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [handle, setHandle] = useState(activeHandle);

  useEffect(() => {
    if (activeHandle) {
      setHandle(activeHandle);
      return;
    }
    // Fallback to locally stored active creator handle
    const stored = typeof window !== 'undefined' ? localStorage.getItem('ee_active_handle') : null;
    if (stored) setHandle(stored);
  }, [activeHandle]);

  // Close mobile drawer on route transition
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const navItems = [
    {
      label: 'Dashboard',
      href: '/dashboard',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      label: 'Recommendations',
      href: '/recommendations',
      icon: Sparkles,
      badge: 'AI',
      badgeColor: 'bg-stone-900 text-stone-100',
    },
    {
      label: 'Calendar & Slots',
      href: '/calendar',
      icon: Calendar,
      badge: null,
    },
    {
      label: 'Notifications',
      href: '/notifications',
      icon: Bell,
      badge: unreadCount > 0 ? String(unreadCount) : null,
      badgeColor: 'bg-rose-600 text-white font-bold',
    },
    {
      label: 'Settings',
      href: '/settings',
      icon: Settings,
      badge: null,
    },
  ];

  const cleanHandle = handle.replace(/^@/, '');
  const avatarSrc = cleanHandle ? `/api/proxy/api/media/avatar?handle=${encodeURIComponent(cleanHandle)}` : null;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#181A1A] text-stone-200 border-r border-stone-800/80 w-64 select-none">
      {/* Brand Header */}
      <div className="h-16 px-6 flex items-center justify-between border-b border-stone-800">
        <Link href="/dashboard" className="flex items-center space-x-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-stone-100 text-[#181A1A] font-extrabold flex items-center justify-center text-base tracking-tighter shadow-sm group-hover:scale-105 transition-transform">
            EE
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight text-stone-100 group-hover:text-white transition">
              EntangledEcho
            </span>
            <span className="text-[10px] text-stone-400 font-mono tracking-wider uppercase">
              Creator Studio
            </span>
          </div>
        </Link>
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden p-1.5 text-stone-400 hover:text-white rounded-md hover:bg-stone-800 transition"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 py-6 px-3 space-y-6 overflow-y-auto">
        <div>
          <div className="px-3 mb-2 text-[10px] font-mono tracking-widest uppercase text-stone-400">
            Publishing & Optimization
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                    active
                      ? 'bg-stone-800/90 text-white font-semibold shadow-xs'
                      : 'text-stone-300 hover:bg-stone-800/40 hover:text-stone-100'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Icon className={`w-4 h-4 ${active ? 'text-white' : 'text-stone-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded text-xs font-mono ${
                        item.badgeColor || 'bg-stone-800 text-stone-300'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div>
          <div className="px-3 mb-2 text-[10px] font-mono tracking-widest uppercase text-stone-400">
            Operations
          </div>
          <nav className="space-y-1">
            <Link
              href="/admin"
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition ${
                pathname?.startsWith('/admin')
                  ? 'bg-stone-800 text-white font-semibold'
                  : 'text-stone-300 hover:bg-stone-800/40 hover:text-stone-100'
              }`}
            >
              <div className="flex items-center space-x-3">
                <ShieldCheck className="w-4 h-4 text-stone-400" />
                <span>Admin Console</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
            </Link>
          </nav>
        </div>
      </div>

      {/* Creator Profile Footer */}
      <div className="p-3 border-t border-stone-800/80 bg-stone-900/40">
        <div className="flex items-center space-x-3 p-2 rounded-lg bg-stone-800/50 border border-stone-800">
          <div className="relative w-9 h-9 rounded-full overflow-hidden bg-stone-700 flex-shrink-0 border border-stone-600">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt={cleanHandle}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fb = e.currentTarget.parentElement?.querySelector('.avatar-fallback');
                  if (fb) (fb as HTMLElement).style.display = 'flex';
                }}
              />
            ) : null}
            <div className="avatar-fallback hidden w-full h-full bg-[#373E3E] text-stone-100 items-center justify-center font-bold text-xs uppercase font-mono">
              {cleanHandle.slice(0, 2).toUpperCase() || '?'}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-stone-200 truncate">
              {cleanHandle ? `@${cleanHandle}` : 'No Account'}
            </div>
            <div className="flex items-center space-x-1.5 text-[10px] text-emerald-400 font-mono">
              <Radio className="w-2.5 h-2.5 animate-pulse text-emerald-400" />
              <span>Synced</span>
            </div>
          </div>
          <Link
            href="/settings"
            className="p-1.5 text-stone-400 hover:text-white rounded hover:bg-stone-700/60 transition"
            title="Account Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <aside className="hidden md:flex flex-col fixed inset-y-0 left-0 z-30 shadow-lg">
        {sidebarContent}
      </aside>

      {/* Mobile Top Bar with Hamburger */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-[#181A1A] text-white border-b border-stone-800 sticky top-0 z-30">
        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-md hover:bg-stone-800 text-stone-300"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm tracking-tight">EntangledEcho</span>
        </div>
        {cleanHandle && (
          <div className="flex items-center space-x-1.5 text-xs text-stone-300 bg-stone-800 px-2.5 py-1 rounded-full border border-stone-700">
            <Instagram className="w-3 h-3 text-pink-400" />
            <span className="truncate max-w-[120px]">@{cleanHandle}</span>
          </div>
        )}
      </div>

      {/* Mobile Overlay Drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-[#181A1A] z-10 shadow-2xl">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
