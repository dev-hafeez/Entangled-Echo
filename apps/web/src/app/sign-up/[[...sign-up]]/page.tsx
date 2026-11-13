import { SignUp } from '@clerk/nextjs';
import { Suspense } from 'react';
import Link from 'next/link';

export default function SignUpPage() {
  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-white">
      {/* Left side: Image presentation that blends seamlessly into the form */}
      <div className="relative hidden md:flex md:w-1/2 lg:w-3/5 bg-slate-950 overflow-hidden flex-col justify-between p-12 text-white">
        {/* Background art / photo overlay */}
        <div
          className="absolute inset-0 bg-cover bg-center opacity-70"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1600&q=80')`,
          }}
        />

        {/* Gradient blend mask: blends into the clean right side */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-slate-950/40 to-white" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-slate-950/40" />

        {/* Top Branding */}
        <div className="relative z-10 flex items-center gap-3">
          <Link href="/" className="text-2xl font-bold tracking-tight text-white hover:opacity-90">
            EntangledEcho
          </Link>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/20 text-white font-mono backdrop-blur-sm">
            AI Analytics & Growth
          </span>
        </div>

        {/* Bottom Quote / Hero Text */}
        <div className="relative z-10 max-w-lg space-y-3">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Grow your audience with ease.
          </h2>
          <p className="text-sm text-slate-200 leading-relaxed">
            Understand your best posts, get personalized tips, and know exactly when to share your next post.
          </p>
        </div>
      </div>

      {/* Right side: Clerk Signup Form */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 md:p-12 bg-white">
        <div className="w-full max-w-md flex flex-col items-center">
          <div className="md:hidden mb-6 text-center">
            <Link href="/" className="text-2xl font-bold tracking-tight text-slate-900">
              EntangledEcho
            </Link>
          </div>
          <Suspense fallback={<div className="text-sm text-slate-500 animate-pulse">Loading sign up...</div>}>
            <SignUp
              routing="path"
              path="/sign-up"
              signInUrl="/sign-in"
              forceRedirectUrl="/dashboard"
              appearance={{
                elements: {
                  rootBox: 'w-full shadow-none',
                  card: 'shadow-none border-0 p-0 w-full',
                  headerTitle: 'text-2xl font-bold text-slate-900',
                  headerSubtitle: 'text-sm text-slate-600',
                },
              }}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
