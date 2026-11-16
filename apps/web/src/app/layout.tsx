'use client';

import './globals.css';
import { ReactNode, useEffect } from 'react';
import { ClerkProvider, useAuth } from '@clerk/nextjs';
import { setClerkTokenGetter } from '@/lib/api';
import { AppShell } from '@/components/AppShell';

function ClerkTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setClerkTokenGetter(() => getToken());
  }, [getToken]);
  return null;
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <ClerkTokenBridge />
      <html lang="en">
        <body className="min-h-screen bg-[#FAFAFA] text-stone-900 antialiased font-sans">
          <AppShell>{children}</AppShell>
        </body>
      </html>
    </ClerkProvider>
  );
}
