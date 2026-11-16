'use client';

import Link from 'next/link';
import { useUser, SignInButton } from '@clerk/nextjs';

export default function LandingPage() {
  const { isSignedIn, isLoaded } = useUser();

  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center select-none z-50">
      <div className="flex flex-col items-center gap-3">
        <Link
          href={isSignedIn ? '/dashboard' : '/sign-in'}
          className="text-black text-2xl md:text-3xl font-medium tracking-tight hover:opacity-75 transition cursor-pointer"
        >
          landing page
        </Link>

        {isLoaded && (
          <div className="text-xs">
            {isSignedIn ? (
              <Link
                href="/dashboard"
                className="text-neutral-500 hover:text-black transition font-mono text-[11px] underline"
              >
                Go to Dashboard &rarr;
              </Link>
            ) : (
              <SignInButton mode="modal">
                <button className="text-neutral-400 hover:text-black transition font-mono text-[11px] underline">
                  Sign in
                </button>
              </SignInButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
