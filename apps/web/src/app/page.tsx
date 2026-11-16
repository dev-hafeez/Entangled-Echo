'use client';

import React from 'react';
import Link from 'next/link';
import {
  Calendar,
  Sparkles,
  BarChart3,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Instagram,
  Facebook,
  Layers,
  Cpu,
} from 'lucide-react';
import { SignInButton, SignUpButton, Show } from '@clerk/nextjs';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#FAFAFA] text-stone-900 font-sans selection:bg-stone-900 selection:text-white">
      {/* Top Navigation */}
      <header className="border-b border-stone-200/80 bg-white/95 backdrop-blur-xs sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-[#373E3E] text-white font-extrabold flex items-center justify-center text-sm tracking-tight">
              EE
            </div>
            <span className="font-bold text-base tracking-tight text-stone-900">
              EntangledEcho
            </span>
          </div>

          <nav className="hidden md:flex items-center space-x-6 text-xs font-semibold text-stone-600">
            <a href="#optimizer" className="hover:text-black transition">
              QUBO Optimizer
            </a>
            <a href="#copywriting" className="hover:text-black transition">
              Caption Frameworks
            </a>
            <a href="#pipeline" className="hover:text-black transition">
              Publishing Pipeline
            </a>
            <Link href="/admin" className="hover:text-black transition flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Admin</span>
            </Link>
          </nav>

          <div className="flex items-center space-x-3">
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-stone-300 hover:bg-stone-100 transition text-stone-800">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="text-xs font-semibold px-3.5 py-1.5 rounded-lg border border-black bg-black text-white hover:bg-stone-800 transition shadow-xs">
                  Get Started
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <Link
                href="/dashboard"
                className="text-xs font-semibold px-4 py-2 rounded-lg border border-black bg-black text-white hover:bg-stone-800 transition flex items-center space-x-1.5 shadow-xs"
              >
                <span>Launch Studio</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </Show>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 md:py-28 px-6 max-w-5xl mx-auto text-center space-y-6">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-mono font-medium bg-stone-100 text-stone-800 border border-stone-300 shadow-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Simulated Annealing + QUBO Schedule Optimizer</span>
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-stone-900 max-w-4xl mx-auto leading-[1.12]">
          Social timing without the guesswork. Grounded in your real data.
        </h1>

        <p className="text-base sm:text-lg text-stone-600 max-w-2xl mx-auto leading-relaxed">
          Ingest Instagram and Facebook post performance, solve multi-constraint weekly posting slots with a quantum-inspired solver, and generate diverse, audience-targeted captions.
        </p>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="w-full sm:w-auto text-sm font-semibold px-6 py-3 rounded-lg border border-black bg-black text-white hover:bg-stone-800 transition-colors flex items-center justify-center space-x-2 shadow-sm"
          >
            <span>Open Creator Dashboard</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/recommendations"
            className="w-full sm:w-auto text-sm font-semibold px-6 py-3 rounded-lg border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 transition-colors flex items-center justify-center space-x-2 shadow-xs"
          >
            <Sparkles className="w-4 h-4 text-stone-600" />
            <span>Explore Recommendations</span>
          </Link>
        </div>

        {/* Platform badges */}
        <div className="pt-8 flex items-center justify-center space-x-6 text-xs text-stone-500 font-mono">
          <span className="flex items-center gap-1.5">
            <Instagram className="w-4 h-4 text-pink-600" />
            Instagram Graph API
          </span>
          <span>•</span>
          <span className="flex items-center gap-1.5">
            <Facebook className="w-4 h-4 text-blue-600" />
            Facebook Page API
          </span>
          <span>•</span>
          <span className="flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-stone-700" />
            Simulated Annealing
          </span>
        </div>
      </section>

      {/* Feature Section 1: The QUBO Optimizer */}
      <section id="optimizer" className="py-16 border-t border-stone-200 bg-white px-6">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl mb-12">
            <span className="text-xs font-mono uppercase tracking-widest text-stone-400 font-semibold">
              Timing Engine
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-stone-900 mt-1">
              Quadratic Unconstrained Binary Optimization (QUBO)
            </h2>
            <p className="text-sm text-stone-600 mt-2 leading-relaxed">
              Instead of random slot picking, the scheduler treats the 168 hours of the week as binary variables. It penalizes tight gaps and blackout hours, while maximizing historical performance scores.
            </p>
          </div>

          {/* Demonstration Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-xl border border-stone-200 bg-stone-50/50 space-y-3">
              <div className="w-10 h-10 rounded-lg bg-stone-200/80 flex items-center justify-center text-stone-800">
                <Clock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-stone-900">Shrinkage & Priors</h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                Accounts with sparse history get stabilized through empirical Bayesian shrinkage, combining day and hour marginals before solving.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-stone-200 bg-stone-50/50 space-y-3">
              <div className="w-10 h-10 rounded-lg bg-stone-200/80 flex items-center justify-center text-stone-800">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-stone-900">Conflict Constraints</h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                Configurable minimum spacing hours and weekly post quotas are enforced via quadratic penalty terms in the Hamiltonian energy equation.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-stone-200 bg-stone-50/50 space-y-3">
              <div className="w-10 h-10 rounded-lg bg-stone-200/80 flex items-center justify-center text-stone-800">
                <BarChart3 className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-stone-900">Bootstrap Confidence</h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                Resampling post histories 30 times produces genuine stability percentages for each recommended slot, not arbitrary confidence figures.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Section 2: Diverse Copywriting Angles */}
      <section id="copywriting" className="py-16 border-t border-stone-200 bg-[#FAFAFA] px-6">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl mb-12">
            <span className="text-xs font-mono uppercase tracking-widest text-stone-400 font-semibold">
              Copywriting & Strategy
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-stone-900 mt-1">
              3 Distinct Angles per Post. Tiered Hashtags.
            </h2>
            <p className="text-sm text-stone-600 mt-2 leading-relaxed">
              No single caption fits every campaign goal. Choose between narrative community building, fast scroller pattern interrupts, or in-depth bookmarkable breakdowns.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-xl border border-stone-200 bg-white shadow-xs space-y-3">
              <div className="text-xs font-mono font-semibold text-stone-500 uppercase">
                Angle 1: Community
              </div>
              <h3 className="text-base font-bold text-stone-900">📖 Storytelling & Relatable</h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                Anecdotal opening hook, vulnerable reflection, and conversation starter. Optimized to drive comments and community debate.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-stone-200 bg-white shadow-xs space-y-3">
              <div className="text-xs font-mono font-semibold text-stone-500 uppercase">
                Angle 2: Watch Time
              </div>
              <h3 className="text-base font-bold text-stone-900">⚡ Short & Punchy (Viral)</h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                Bold pattern-interrupt opening statement, 2-line payoff, and crisp call to action for quick scrollers and reels.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-stone-200 bg-white shadow-xs space-y-3">
              <div className="text-xs font-mono font-semibold text-stone-500 uppercase">
                Angle 3: Saves & Bookmarks
              </div>
              <h3 className="text-base font-bold text-stone-900">📚 In-Depth Breakdown</h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                3-point actionable structure with bulleted advice and save CTA. Built for algorithm reference bookmarking.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Section 3: Publishing Pipeline */}
      <section id="pipeline" className="py-16 border-t border-stone-200 bg-white px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start justify-between gap-12">
          <div className="max-w-md space-y-4">
            <span className="text-xs font-mono uppercase tracking-widest text-stone-400 font-semibold">
              Execution
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-stone-900">
              60-Second Auto-Publishing Tick
            </h2>
            <p className="text-sm text-stone-600 leading-relaxed">
              Posts scheduled on the interactive calendar transition through a strict state machine: Draft $\rightarrow$ Scheduled $\rightarrow$ Publishing $\rightarrow$ Published.
            </p>
            <ul className="space-y-2.5 pt-2 text-xs text-stone-700">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Exponential back-off retry (3 attempts) on network dropouts</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Direct container creation on Instagram Graph API</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>In-app reminder notifications 30 minutes prior to delivery</span>
              </li>
            </ul>
          </div>

          <div className="flex-1 w-full p-6 rounded-xl border border-stone-200 bg-stone-50 space-y-4 font-mono text-xs text-stone-700">
            <div className="text-stone-400 uppercase tracking-wider text-[11px]">State Machine Lifecycle</div>
            <div className="p-3 bg-white rounded border border-stone-200 space-y-1">
              <div className="flex justify-between font-semibold">
                <span className="text-blue-600">SCHEDULED</span>
                <span className="text-stone-400">Queue Worker active</span>
              </div>
              <div className="text-stone-500 text-[11px]">Locked via FOR UPDATE SKIP LOCKED on publication tick</div>
            </div>
            <div className="p-3 bg-white rounded border border-stone-200 space-y-1">
              <div className="flex justify-between font-semibold">
                <span className="text-amber-600">PUBLISHING</span>
                <span className="text-stone-400">Dispatching container</span>
              </div>
              <div className="text-stone-500 text-[11px]">Uploading media container to Graph endpoint</div>
            </div>
            <div className="p-3 bg-white rounded border border-stone-200 space-y-1">
              <div className="flex justify-between font-semibold">
                <span className="text-emerald-600">PUBLISHED</span>
                <span className="text-stone-400">Success</span>
              </div>
              <div className="text-stone-500 text-[11px]">External post ID recorded; metrics collector scheduled</div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-200 bg-white py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6 text-xs text-stone-500">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded bg-[#373E3E] text-white font-bold flex items-center justify-center text-xs">
              EE
            </div>
            <span className="font-semibold text-stone-800">EntangledEcho</span>
            <span>— Social Intelligence & QUBO Optimization</span>
          </div>

          <div className="flex items-center space-x-6">
            <Link href="/dashboard" className="hover:text-black transition">
              Dashboard
            </Link>
            <Link href="/recommendations" className="hover:text-black transition">
              Recommendations
            </Link>
            <Link href="/calendar" className="hover:text-black transition">
              Calendar
            </Link>
            <Link href="/admin" className="hover:text-black transition">
              Admin
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
