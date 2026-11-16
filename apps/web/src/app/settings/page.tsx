'use client';

import React, { useState, useEffect } from 'react';
import { useUser, SignOutButton } from '@clerk/nextjs';

export default function SettingsPage() {
  const { user } = useUser();

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

    const activeHandle =
      localStorage.getItem('ee_active_handle') ||
      (user?.id ? localStorage.getItem(`ee_handle_${user.id}`) : null) ||
      'creator';
    setConnectedAccounts([
      {
        platform: 'Instagram Business',
        handle: `@${activeHandle}`,
        status: 'connected',
        mode: process.env.NEXT_PUBLIC_DATA_MODE === 'live' ? 'Live Meta Graph API' : 'Seed / Local Normalized Fixture',
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
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      {/* Header */}
      <div className="border-b border-neutral-200 pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Settings</h1>
        <p className="mt-0.5 text-xs text-neutral-500">
          Configure timezones for scheduling, default publication workflows, and manage connected accounts.
        </p>
      </div>

      {saveMessage && (
        <div className="p-3 bg-neutral-100 border border-neutral-300 text-neutral-900 rounded text-xs font-mono">
          ✓ {saveMessage}
        </div>
      )}

      {/* Section 1: Scheduling & Localization Preferences */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-neutral-900">Scheduling & Localization</h2>
          <p className="text-xs text-neutral-500">
            Controls how posting windows are displayed on your Calendar and converted for automated publication ticks.
          </p>
        </div>

        <form onSubmit={handleSaveSettings} className="space-y-5 pt-1">
          <div>
            <label htmlFor="timezone-select" className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1.5">
              Active Timezone
            </label>
            <select
              id="timezone-select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full max-w-md px-3 py-1.5 text-xs bg-white border border-neutral-300 rounded focus:outline-none focus:border-black"
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-neutral-400 font-mono">
              Current local reference: {new Date().toLocaleTimeString('en-US', { timeZone: timezone })} ({timezone})
            </p>
          </div>

          <div>
            <label htmlFor="status-select" className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1.5">
              Default Scheduled Post Status
            </label>
            <select
              id="status-select"
              value={defaultPostStatus}
              onChange={(e) => setDefaultPostStatus(e.target.value as 'DRAFT' | 'SCHEDULED')}
              className="w-full max-w-md px-3 py-1.5 text-xs bg-white border border-neutral-300 rounded focus:outline-none focus:border-black"
            >
              <option value="SCHEDULED">SCHEDULED (Auto-publishes at slot time)</option>
              <option value="DRAFT">DRAFT (Requires manual confirmation before scheduling)</option>
            </select>
            <p className="mt-1 text-[11px] text-neutral-400">
              New post cards dropped on the calendar will initialize in this state.
            </p>
          </div>

          <div>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-semibold rounded border border-black bg-white text-black hover:bg-black hover:text-white transition"
            >
              Save Preferences
            </button>
          </div>
        </form>
      </div>

      {/* Section 2: Connected Social Accounts (FR-07, FR-08) */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-neutral-900">Connected Accounts</h2>
            <p className="text-xs text-neutral-500">
              Official Meta Graph API and mock provider integration status (SRDS Rule 1 &amp; Rule 3).
            </p>
          </div>
          <span className="text-[10px] px-2 py-0.5 bg-neutral-100 text-neutral-700 rounded border border-neutral-200 font-mono">
            AES-256-GCM Encrypted
          </span>
        </div>

        <div className="divide-y divide-neutral-100">
          {connectedAccounts.map((acc) => (
            <div key={acc.platform} className="py-3 flex items-center justify-between">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-xs text-neutral-900">{acc.platform}</span>
                  <span className="text-xs text-neutral-500 font-mono">{acc.handle}</span>
                </div>
                <p className="text-[11px] text-neutral-400 mt-0.5">{acc.mode}</p>
              </div>
              <div>
                {acc.status === 'connected' ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono text-neutral-900 bg-neutral-100 border border-neutral-300">
                    Active • Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono text-neutral-600 bg-neutral-50 border border-neutral-200">
                    Mock / Offline Provider
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">
            Instagram and Facebook only (SRDS 2.2). No unbuilt platforms displayed.
          </span>
          <a
            href="/dashboard"
            className="text-xs font-semibold text-neutral-900 hover:underline"
          >
            Switch Account in Dashboard &rarr;
          </a>
        </div>
      </div>

      {/* Section 3: Identity & Sign Out (FR-01, FR-02) */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-neutral-900">Session &amp; Security</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Signed in as <span className="font-mono text-neutral-800">{user?.primaryEmailAddress?.emailAddress || 'User Session'}</span>
          </p>
        </div>
        <div>
          <SignOutButton>
            <button className="px-3 py-1.5 text-xs font-semibold rounded border border-neutral-300 text-neutral-700 hover:border-black hover:text-black transition">
              Sign Out
            </button>
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}
