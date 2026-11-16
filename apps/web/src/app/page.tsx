import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Sparkles, Calendar, BarChart3, ArrowRight } from 'lucide-react';

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col justify-between selection:bg-slate-900 selection:text-white">
      {/* Top Navigation */}
      <header className="border-b border-slate-100 bg-white/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="font-bold text-xl tracking-tight text-primary">EntangledEcho</span>
            <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono uppercase tracking-wider">
              Platform
            </span>
          </div>
          <div className="flex items-center space-x-3">
            <Link href="/sign-in">
              <Button size="sm">Log In</Button>
            </Link>
            <Link href="/sign-up">
              <Button size="sm">Register</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col justify-center">
        {/* Hero Section */}
        <section className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>AI-Powered Content &amp; Schedule Optimization</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.15]">
            EntangledEcho
          </h1>

          <p className="max-w-2xl mx-auto text-lg sm:text-xl text-slate-600 leading-relaxed font-normal">
            Quantum-inspired schedule optimization and AI-driven content intelligence for social creators.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link href="/sign-up" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto flex items-center gap-2 group">
                <span>Register</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Link href="/sign-in" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto">
                Log In
              </Button>
            </Link>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-16 sm:py-24 bg-slate-50/60 border-t border-slate-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            <div className="text-center space-y-3 max-w-2xl mx-auto">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Core Capabilities
              </h2>
              <p className="text-sm sm:text-base text-slate-600">
                A focused workflow designed to analyze, optimize, and schedule your social media publishing.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <Card>
                <CardHeader className="space-y-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-primary">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <CardTitle className="text-lg">AI Content Recommendations</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Synthesizes account performance history and trending topics to generate structured caption drafts, hooks, and tailored hashtag strategies.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-slate-500 font-mono pt-0">
                  Topic analysis • Niche alignment • Draft generation
                </CardContent>
              </Card>

              {/* Feature 2 */}
              <Card>
                <CardHeader className="space-y-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-primary">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <CardTitle className="text-lg">Optimal Posting-Time Scheduling</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Formulates weekly posting schedules as a QUBO problem solved with simulated annealing to determine highest-probability engagement slots.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-slate-500 font-mono pt-0">
                  QUBO optimization • Feasibility constraints • Calendar sync
                </CardContent>
              </Card>

              {/* Feature 3 */}
              <Card>
                <CardHeader className="space-y-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-primary">
                    <BarChart3 className="w-5 h-5" />
                  </div>
                  <CardTitle className="text-lg">Engagement Analytics</CardTitle>
                  <CardDescription className="leading-relaxed">
                    Aggregates engagement metrics across image, carousel, and video formats with interactive trend charts and complete CSV data export.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-slate-500 font-mono pt-0">
                  Historical trends • Format breakdown • CSV export
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-800">EntangledEcho</span>
            <span>&copy; {new Date().getFullYear()} EntangledEcho. All rights reserved.</span>
          </div>
          <div className="flex items-center space-x-6">
            <Link href="/sign-in" className="hover:text-slate-900 transition-colors">
              Sign In
            </Link>
            <Link href="/sign-up" className="hover:text-slate-900 transition-colors">
              Create Account
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
