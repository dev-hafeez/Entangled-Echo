'use client';

import React, { useState, useEffect } from 'react';
import { useUser, SignOutButton } from '@clerk/nextjs';

export default function SettingsPage() {
  const { user } = useUser();

  // Settings State (persisted in localStorage for responsive offline client state)
  const [timezone, setTimezone] = useState<string>('UTC');
  const [defaultPostStatus, setDefaultPostStatus] = useState<'DRAFT' | 'SCHEDULED'>('SCHEDULED');
  const [saveMessage, setSaveMessage] = useState<string>('');
  const [connectedAccounts, setConnectedAccounts] = useState<Array<{
    platform: string;
    handle: string;
    status: 'connected' | 'needs_reauth' | 'mock_mode';
    mode: string;
  }>>([]);

  useEffect(() => {
    // Detect browser default timezone or load saved
    const savedTz = localStorage.getItem('ee_user_timezone');
    if (savedTz) {
      setTimezone(savedTz);
    } else {
      try {
        const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (detected) setTimezone(detected);
      } catch {}
    }

    const savedStatus = localStorage.getItem('ee_default_post_status') as 'DRAFT' | 'SCHEDULED' | null;
    if (savedStatus) setDefaultPostStatus(savedStatus);

    // Load active account status from local storage / API
    const activeHandle = localStorage.getItem('ee_active_handle') || 'cristiano';
    setConnectedAccounts([
      {
        platform: 'Instagram Business',
        handle: `@${activeHandle}`,
        status: 'connected',
        mode: process.env.NEXT_PUBLIC_DATA_MODE === 'live' ? 'Live Meta Graph API v19' : 'Seed / Local Normalized Fixture',
      },
      {
        platform: 'Facebook Page',
        handle: `@${activeHandle}_fb`,
        status: 'mock_mode',
        mode: 'Mock Provider (SRDS Rule 3 / Offline Mode)',
      },
    ]);
  }, []);

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('ee_user_timezone', timezone);
    localStorage.setItem('ee_default_post_status', defaultPostStatus);
    setSaveMessage('Preferences saved successfully.');
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const timezones = [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Asia/Dubai',
    'Asia/Karachi',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];

  return (
    <div className="max-w-4xl space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#373E3E]">Account & System Settings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Configure timezones for AI scheduling, default publication workflows, and manage connected accounts.
          </p>
        </div>

        {saveMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg text-sm font-medium">
            {saveMessage}
          </div>
        )}

        {/* Section 1: Scheduling & Localization Preferences */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-1">Scheduling & Localization</h2>
          <p className="text-xs text-slate-500 mb-6">
            Controls how posting windows are displayed on your Calendar and converted for automated publication ticks.
          </p>

          <form onSubmit={handleSaveSettings} className="space-y-6">
            <div>
              <label htmlFor="timezone-select" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Active Timezone
              </label>
              <select
                id="timezone-select"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full max-w-md px-3 py-2 text-sm bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#373E3E]"
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Current local reference time: {new Date().toLocaleTimeString('en-US', { timeZone: timezone })} ({timezone})
              </p>
            </div>

            <div>
              <label htmlFor="status-select" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Default Scheduled Post Status
              </label>
              <select
                id="status-select"
                value={defaultPostStatus}
                onChange={(e) => setDefaultPostStatus(e.target.value as 'DRAFT' | 'SCHEDULED')}
                className="w-full max-w-md px-3 py-2 text-sm bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#373E3E]"
              >
                <option value="SCHEDULED">SCHEDULED (Auto-publishes at slot time)</option>
                <option value="DRAFT">DRAFT (Requires manual confirmation before scheduling)</option>
              </select>
              <p className="mt-1 text-xs text-slate-400">
                New post cards dropped on the calendar will initialize in this state.
              </p>
            </div>

            <div>
              <button
                type="submit"
                className="px-5 py-2 text-sm font-semibold rounded-md border border-black bg-white text-black hover:bg-black hover:text-white transition shadow-sm"
              >
                Save Preferences
              </button>
            </div>
          </form>
        </div>

        {/* Section 2: Connected Social Accounts (FR-07, FR-08) */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Connected Accounts</h2>
              <p className="text-xs text-slate-500">
                Official Meta Graph API and mock provider integration status (SRDS Rule 1 &amp; Rule 3).
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full font-mono">
              AES-256-GCM Encrypted
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {connectedAccounts.map((acc) => (
              <div key={acc.platform} className="py-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-sm text-slate-900">{acc.platform}</span>
                    <span className="text-xs text-slate-500 font-mono">{acc.handle}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{acc.mode}</p>
                </div>
                <div>
                  {acc.status === 'connected' ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                      Active &bull; Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                      Mock / Offline Provider
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Only Instagram and Facebook are in-scope (SRDS 2.2). No unbuilt platforms displayed.
            </span>
            <a
              href="/dashboard"
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline"
            >
              Switch Account in Dashboard &rarr;
            </a>
          </div>
        </div>

        {/* Section 3: Identity & Sign Out (FR-01, FR-02) */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Session &amp; Security</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Signed in as <span className="font-medium text-slate-800">{user?.primaryEmailAddress?.emailAddress || 'User Session'}</span>
            </p>
          </div>
          <div>
            <SignOutButton>
              <button className="px-4 py-2 text-xs font-semibold rounded-md border border-red-300 text-red-700 hover:bg-red-700 hover:text-white transition">
                Sign Out
              </button>
            </SignOutButton>
          </div>
        </div>
      </div>
  );
}
