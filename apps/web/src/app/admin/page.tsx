'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Scraper Form
  const [targetsText, setTargetsText] = useState('');
  const [maxPosts, setMaxPosts] = useState<string>('60');
  const [headless, setHeadless] = useState<boolean>(true);
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState('');

  // Data
  const [jobs, setJobs] = useState<any[]>([]);
  const [totalJobs, setTotalJobs] = useState<number>(0);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Queue filtering, search & pagination for scaling to 2,000+ jobs
  const [jobStatusFilter, setJobStatusFilter] = useState<string>('all');
  const [jobSearch, setJobSearch] = useState<string>('');
  const [jobPage, setJobPage] = useState<number>(1);
  const [jobLimit, setJobLimit] = useState<number>(100);
  const [jobSummary, setJobSummary] = useState<any>({
    total: 0,
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  });
  const [jobPagination, setJobPagination] = useState<any>({
    page: 1,
    limit: 100,
    total: 0,
    totalPages: 1,
  });

  // Accounts pagination & search
  const [accountPage, setAccountPage] = useState<number>(1);
  const [accountSearch, setAccountSearch] = useState<string>('');
  const accountsPerPage = 20;

  const showNotice = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => {
      setActionNotice((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  // Training
  const [trainingGlobal, setTrainingGlobal] = useState(false);
  const [trainingPersonal, setTrainingPersonal] = useState(false);
  const [selectedAccountForTrain, setSelectedAccountForTrain] = useState('');
  const [modelMsg, setModelMsg] = useState('');

  // Prediction playground
  const [predHandle, setPredHandle] = useState('');
  const [predCaption, setPredCaption] = useState('');
  const [predMediaType, setPredMediaType] = useState('image');
  const [predTime, setPredTime] = useState('');
  const [predLoading, setPredLoading] = useState(false);
  const [predResult, setPredResult] = useState<any>(null);

  // Session Auth & Canary State
  const [sessionInfo, setSessionInfo] = useState<{ authenticated: boolean; cookieNames: string[]; reason?: string } | null>(null);
  const [canaryResult, setCanaryResult] = useState<any>(null);
  const [canaryLoading, setCanaryLoading] = useState(false);
  const [isQueuePaused, setIsQueuePaused] = useState<boolean>(true);
  const [curatedListSummary, setCuratedListSummary] = useState<any>(null);
  const [loadingCurated, setLoadingCurated] = useState(false);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalMsg, setEvalMsg] = useState('');
  const [latestEval, setLatestEval] = useState<any>(null);
  const [evalMarkdown, setEvalMarkdown] = useState<string>('');
  const [evalSnapshot, setEvalSnapshot] = useState('2026-11-03-clean-v2');

  // Check auth
  useEffect(() => {
    let isMounted = true;
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) {
          setIsAuthenticated(Boolean(data.authenticated));
        }
      })
      .catch(() => {
        if (isMounted) setIsAuthenticated(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch data with active filters and pagination (decoupled so fast local data renders immediately)
  const loadData = async (
    filter: string = jobStatusFilter,
    search: string = jobSearch,
    page: number = jobPage,
    limit: number = jobLimit
  ) => {
    // 1. Fetch Accounts immediately from local storage
    api.getAccounts().then((a) => {
      if (a?.accounts) setAccounts(a.accounts);
    }).catch((e) => console.error('Failed to load accounts:', e));

    // 2. Fetch Models immediately from local storage
    api.getModels().then((m) => {
      if (m?.models) setModels(m.models);
    }).catch((e) => console.error('Failed to load models:', e));

    // 3. Fetch Jobs independently
    api.getJobs({ status: filter, search, page, limit }).then((j) => {
      if (j?.jobs) setJobs(j.jobs);
      if (j?.pagination) setJobPagination(j.pagination);
      if (j?.isPaused !== undefined) setIsQueuePaused(j.isPaused);
      if (j?.summary) {
        setJobSummary(j.summary);
        setTotalJobs(j.summary.total);
      } else {
        setTotalJobs(j.total ?? (j.jobs?.length || 0));
      }
    }).catch((e) => console.error('Failed to load jobs:', e));

    // 4. Fetch Latest Evaluation
    api.getLatestEval().then((res) => {
      if (res?.run) setLatestEval(res.run);
      if (res?.markdown) setEvalMarkdown(res.markdown);
    }).catch(() => {});

    // 5. Fetch Session Status & Curated List
    api.getSessionStatus().then((s) => setSessionInfo(s)).catch(() => {});
    api.getCuratedList().then((c) => setCuratedListSummary(c.summary)).catch(() => {});
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadData(jobStatusFilter, jobSearch, jobPage, jobLimit);
      const interval = setInterval(
        () => loadData(jobStatusFilter, jobSearch, jobPage, jobLimit),
        5000
      );
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, jobStatusFilter, jobSearch, jobPage, jobLimit]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setIsAuthenticated(true);
        loadData(jobStatusFilter, jobSearch, jobPage, jobLimit);
      } else {
        setAuthError(data.error || 'Invalid administrator password');
      }
    } catch {
      setAuthError('Connection error logging in');
    }
  };

  const handleStartScrape = async () => {
    const lines = targetsText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      setScrapeMsg('Please enter at least one handle or URL');
      return;
    }

    setScrapeLoading(true);
    setScrapeMsg('');
    try {
      const parsedMax = maxPosts.trim() === '' ? null : parseInt(maxPosts, 10);
      await api.startScrape(lines, isNaN(parsedMax as any) ? null : parsedMax, headless);
      setScrapeMsg(`Enqueued ${lines.length} scrape job(s)!`);
      setTargetsText('');
      await loadData();
    } catch (err: any) {
      setScrapeMsg(`Error: ${err.message}`);
    } finally {
      setScrapeLoading(false);
    }
  };

  const handleRetryJob = async (id: string) => {
    try {
      await api.retryJob(id);
      await loadData();
    } catch (err: any) {
      alert(`Retry failed: ${err.message}`);
    }
  };

  const handleCancelJob = async (id: string) => {
    try {
      await api.cancelJob(id);
      await loadData();
    } catch (err: any) {
      alert(`Cancel failed: ${err.message}`);
    }
  };

  const handleDeleteJob = async (id: string) => {
    if (!confirm('Are you sure you want to delete this job from the queue?')) return;
    setDeletingId(id);
    // Optimistic removal
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setTotalJobs((prev) => Math.max(0, prev - 1));

    try {
      await api.deleteJob(id);
      showNotice('Job deleted successfully.');
      await loadData();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
      await loadData();
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearJobs = async (type: 'completed' | 'queued' | 'all') => {
    const label =
      type === 'completed'
        ? 'completed, failed, and cancelled'
        : type === 'queued'
        ? 'all queued'
        : 'ALL (entire queue)';
    if (!confirm(`Are you sure you want to clear ${label} jobs?`)) return;

    setDeletingId(`clear-${type}`);
    // Optimistic removal
    if (type === 'completed') {
      setJobs((prev) => prev.filter((j) => !['done', 'failed', 'cancelled'].includes(j.status)));
    } else if (type === 'queued') {
      setJobs((prev) => prev.filter((j) => j.status !== 'queued'));
    } else if (type === 'all') {
      setJobs([]);
      setTotalJobs(0);
    }

    try {
      const res = await api.clearJobs(type);
      showNotice(res.message || `Cleared ${label} jobs.`);
      await loadData();
    } catch (err: any) {
      alert(`Clear failed: ${err.message}`);
      await loadData();
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAccount = async (id: string, handle: string) => {
    if (
      !confirm(
        `Are you sure you want to delete @${handle} and all its posts, metrics, and media? This cannot be undone.`
      )
    ) {
      return;
    }

    setDeletingId(id);
    // Optimistic removal
    setAccounts((prev) => prev.filter((a) => a.id !== id && a.handle !== handle));

    try {
      await api.deleteAccount(id);
      showNotice(`Account @${handle} and all associated data deleted successfully.`);
      await loadData();
    } catch (err: any) {
      alert(`Delete account failed: ${err.message}`);
      await loadData();
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteModel = async (id: string, version: string) => {
    if (!confirm(`Are you sure you want to delete model version ${version}?`)) return;

    setDeletingId(id);
    // Optimistic removal
    setModels((prev) => prev.filter((m) => m.id !== id));

    try {
      await api.deleteModel(id);
      showNotice(`Model ${version} deleted successfully.`);
      await loadData();
    } catch (err: any) {
      alert(`Delete model failed: ${err.message}`);
      await loadData();
    } finally {
      setDeletingId(null);
    }
  };

  const handleTrainGlobal = async () => {
    setTrainingGlobal(true);
    setModelMsg('');
    try {
      const res = await api.trainGlobalModel();
      setModelMsg(`Global model trained successfully! Version: ${res.model?.version || 'N/A'}`);
      await loadData();
    } catch (err: any) {
      setModelMsg(`Global training error: ${err.message}`);
    } finally {
      setTrainingGlobal(false);
    }
  };

  const handleRunEvaluation = async () => {
    setEvalLoading(true);
    setEvalMsg('');
    try {
      const res = await api.runEval(evalSnapshot, 30);
      setEvalMsg(res.message || 'Evaluation started in background.');
      showNotice('Evaluation harness started. Refreshing in a few moments...');
      setTimeout(async () => {
        try {
          const latest = await api.getLatestEval();
          if (latest?.run) setLatestEval(latest.run);
          if (latest?.markdown) setEvalMarkdown(latest.markdown);
        } catch {}
      }, 5000);
    } catch (err: any) {
      setEvalMsg(`Evaluation error: ${err.message}`);
    } finally {
      setEvalLoading(false);
    }
  };

  const handleTrainPersonal = async () => {
    if (!selectedAccountForTrain) {
      alert('Please select an account first');
      return;
    }
    setTrainingPersonal(true);
    setModelMsg('');
    try {
      const res = await api.trainPersonalModel(selectedAccountForTrain);
      setModelMsg(
        `Personal model trained for @${selectedAccountForTrain}! Version: ${res.model?.version || 'N/A'}`
      );
      await loadData();
    } catch (err: any) {
      setModelMsg(`Personal training error: ${err.message}`);
    } finally {
      setTrainingPersonal(false);
    }
  };

  const handlePredict = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!predHandle) {
      alert('Handle is required');
      return;
    }
    setPredLoading(true);
    setPredResult(null);
    try {
      const res = await api.predict({
        handle: predHandle,
        caption: predCaption,
        mediaType: predMediaType,
        plannedTime: predTime || null,
      });
      setPredResult(res);
    } catch (err: any) {
      alert(`Prediction failed: ${err.message}`);
    } finally {
      setPredLoading(false);
    }
  };

  if (isAuthenticated === null) {
    return <div className="p-8 text-center text-slate-500">Loading admin panel...</div>;
  }

  // Password Gate
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto mt-20 p-6 bg-white border border-slate-200 rounded-lg shadow-sm">
        <h1 className="text-xl font-bold mb-4 text-slate-800">Admin Authentication</h1>
        <p className="text-sm text-slate-600 mb-4">
          Enter the administrator password configured in your environment to access EntangledEcho.
        </p>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Admin Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-800"
              placeholder="••••••••"
              required
            />
          </div>
          {authError && <div className="text-sm text-red-600">{authError}</div>}
          <button
            type="submit"
            className="w-full py-2 px-4 bg-slate-900 text-white rounded font-medium hover:bg-black transition"
          >
            Sign In
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {actionNotice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 rounded-md flex items-center justify-between shadow-sm animate-in fade-in">
          <span>✓ {actionNotice}</span>
          <button
            onClick={() => setActionNotice(null)}
            className="text-emerald-600 hover:text-emerald-900 font-bold ml-4"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex flex-wrap justify-between items-center border-b pb-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">EntangledEcho Admin Console</h1>
          <p className="text-sm text-slate-500">Instagram Scraper, Job Queue, and ML Engine</p>
        </div>
        <div className="flex items-center space-x-3">
          {sessionInfo && (
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-semibold border ${
              sessionInfo.authenticated
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}>
              <span className={`w-2 h-2 rounded-full ${sessionInfo.authenticated ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <span>{sessionInfo.authenticated ? 'Session: Active' : 'Session: Missing'}</span>
            </div>
          )}
          <button
            onClick={() => loadData()}
            className="text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 px-3 py-1.5 rounded font-medium"
          >
            ↻ Refresh Data
          </button>
        </div>
      </div>

      {/* QUICK PRESETS & SESSION BAR */}
      <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Depth Presets:</span>
          <button
            onClick={() => setMaxPosts('12')}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              maxPosts === '12' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            12 (Fast Audit)
          </button>
          <button
            onClick={() => setMaxPosts('60')}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              maxPosts === '60' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            60 (ML Model Ready)
          </button>
          <button
            onClick={() => setMaxPosts('100')}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              maxPosts === '100' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            100 (Deep Archive)
          </button>
        </div>

        <div className="flex items-center space-x-3">
          <button
            disabled={canaryLoading}
            onClick={async () => {
              setCanaryLoading(true);
              try {
                const res = await api.runCanaryCheck();
                setCanaryResult(res);
                showNotice(res.passed ? '✓ Canary passed (all 3 posts extracted)' : `✗ Canary failed: ${res.error}`);
              } catch (e: any) {
                showNotice(`Canary error: ${e.message}`);
              } finally {
                setCanaryLoading(false);
              }
            }}
            className="text-xs bg-white hover:bg-slate-100 border border-slate-300 px-3 py-1 rounded font-medium flex items-center space-x-1"
          >
            <span>{canaryLoading ? 'Testing...' : 'Test Canary Posts'}</span>
            {canaryResult && (
              <span className={`w-2 h-2 rounded-full ${canaryResult.passed ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            )}
          </button>

          {/* Queue Pause/Resume toggle */}
          <button
            onClick={async () => {
              try {
                if (isQueuePaused) {
                  await api.resumeQueue();
                  setIsQueuePaused(false);
                  showNotice('Scrape queue resumed.');
                } else {
                  await api.pauseQueue();
                  setIsQueuePaused(true);
                  showNotice('Scrape queue paused.');
                }
                loadData();
              } catch (e: any) {
                showNotice(`Queue error: ${e.message}`);
              }
            }}
            className={`text-xs px-3 py-1 rounded font-bold border transition-colors ${
              isQueuePaused
                ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600'
                : 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700'
            }`}
          >
            {isQueuePaused ? '▶ Resume Queue' : '⏸ Pause Queue'}
          </button>
        </div>
      </div>

      {/* 1. SCRAPER SECTION */}
      <section className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-800">1. Trigger Scraper</h2>
        <p className="text-sm text-slate-600">
          Paste Instagram handles (e.g. <code className="bg-slate-100 px-1 py-0.5 rounded">natgeo</code>), profile URLs, or post URLs, one per line:
        </p>
        <textarea
          rows={4}
          value={targetsText}
          onChange={(e) => setTargetsText(e.target.value)}
          placeholder={`natgeo\nnasa\nhttps://www.instagram.com/instagram/`}
          className="w-full p-3 font-mono text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-800"
        />
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center space-x-2">
            <label className="text-sm text-slate-700">Max posts per account:</label>
            <input
              type="number"
              min="1"
              max="500"
              value={maxPosts}
              onChange={(e) => setMaxPosts(e.target.value)}
              placeholder="All"
              className="w-24 px-2 py-1 text-sm border border-slate-300 rounded"
            />
            <span className="text-xs text-slate-400">(leave blank for all)</span>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="headless"
              checked={headless}
              onChange={(e) => setHeadless(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <label htmlFor="headless" className="text-sm text-slate-700">
              Headless Chromium
            </label>
          </div>

          <button
            onClick={handleStartScrape}
            disabled={scrapeLoading}
            className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-medium hover:bg-black disabled:opacity-50"
          >
            {scrapeLoading ? 'Enqueueing...' : 'Start Scrape'}
          </button>
        </div>
        {scrapeMsg && (
          <div
            className={`text-sm p-3 rounded ${
              scrapeMsg.startsWith('Error')
                ? 'bg-red-50 text-red-700'
                : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {scrapeMsg}
          </div>
        )}
      </section>

      {/* 2. JOBS QUEUE TABLE */}
      <section className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">2. Scrape Jobs Queue</h2>
            <span className="text-xs text-slate-500">
              Total {jobSummary.total || totalJobs} jobs in database (unlimited queue capacity)
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(jobSummary.done + jobSummary.failed + jobSummary.cancelled > 0 ||
              jobs.some((j) => ['done', 'failed', 'cancelled'].includes(j.status))) && (
              <button
                onClick={() => handleClearJobs('completed')}
                disabled={deletingId === 'clear-completed'}
                className="px-2.5 py-1 text-xs text-slate-700 hover:text-white hover:bg-slate-800 border border-slate-300 rounded font-medium transition-colors disabled:opacity-50"
              >
                {deletingId === 'clear-completed' ? 'Clearing...' : 'Clear Finished'}
              </button>
            )}
            {(jobSummary.queued > 0 || jobs.some((j) => j.status === 'queued')) && (
              <button
                onClick={() => handleClearJobs('queued')}
                disabled={deletingId === 'clear-queued'}
                className="px-2.5 py-1 text-xs text-amber-700 hover:text-white hover:bg-amber-600 border border-amber-300 rounded font-medium transition-colors disabled:opacity-50"
              >
                {deletingId === 'clear-queued' ? 'Clearing...' : 'Clear Queued'}
              </button>
            )}
            {(jobSummary.total > 0 || jobs.length > 0) && (
              <button
                onClick={() => handleClearJobs('all')}
                disabled={deletingId === 'clear-all'}
                className="px-2.5 py-1 text-xs text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-300 rounded font-medium transition-colors disabled:opacity-50"
              >
                {deletingId === 'clear-all' ? 'Purging...' : 'Purge All Jobs'}
              </button>
            )}
          </div>
        </div>

        {/* Filter Badges & Search Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {[
              { key: 'all', label: 'All', count: jobSummary.total },
              { key: 'running', label: 'Running', count: jobSummary.running },
              { key: 'queued', label: 'Queued', count: jobSummary.queued },
              { key: 'done', label: 'Done', count: jobSummary.done },
              { key: 'failed', label: 'Failed', count: jobSummary.failed },
              { key: 'cancelled', label: 'Cancelled', count: jobSummary.cancelled },
            ].map((tab) => {
              const active = jobStatusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => {
                    setJobStatusFilter(tab.key);
                    setJobPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-full font-medium transition-colors ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                  }`}
                >
                  {tab.label} <span className="opacity-75 font-mono ml-0.5">({tab.count ?? 0})</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={jobSearch}
              onChange={(e) => {
                setJobSearch(e.target.value);
                setJobPage(1);
              }}
              placeholder="Search handle or URL..."
              className="px-2.5 py-1 text-xs border border-slate-300 rounded w-44 font-mono focus:outline-none focus:ring-1 focus:ring-slate-800"
            />
            <select
              value={jobLimit}
              onChange={(e) => {
                setJobLimit(parseInt(e.target.value, 10));
                setJobPage(1);
              }}
              className="px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-700"
            >
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
              <option value={250}>250 / page</option>
              <option value={500}>500 / page</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-600 font-medium">
                <th className="p-3">Target</th>
                <th className="p-3">Status</th>
                <th className="p-3">Progress (Found / Detailed / Failed)</th>
                <th className="p-3">Failure Reason / Error</th>
                <th className="p-3">Created / Finished</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-slate-400">
                    No scrape jobs enqueued yet.
                  </td>
                </tr>
              ) : (
                jobs.map((j) => (
                  <tr key={j.id} className="border-b hover:bg-slate-50">
                    <td className="p-3 font-mono font-medium text-slate-800">
                      {j.normalized_handle ? `@${j.normalized_handle}` : j.target_input}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                          j.status === 'done'
                            ? 'bg-emerald-100 text-emerald-800'
                            : j.status === 'running'
                            ? 'bg-blue-100 text-blue-800 animate-pulse'
                            : j.status === 'failed'
                            ? 'bg-rose-100 text-rose-800'
                            : j.status === 'partial'
                            ? 'bg-amber-100 text-amber-800'
                            : j.status === 'cancelled'
                            ? 'bg-slate-200 text-slate-700'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {j.progress_found} / {j.progress_detailed} / {j.progress_failed}
                    </td>
                    <td className="p-3 text-xs text-slate-500 max-w-xs truncate">
                      {j.failure_reason ? `[${j.failure_reason}] ` : ''}
                      {j.error || '-'}
                    </td>
                    <td className="p-3 text-xs text-slate-500">
                      <div>Created: {new Date(j.created_at).toLocaleTimeString()}</div>
                      {j.finished_at && (
                        <div>Done: {new Date(j.finished_at).toLocaleTimeString()}</div>
                      )}
                    </td>
                    <td className="p-3 text-right space-x-2">
                      {(j.status === 'failed' || j.status === 'cancelled') && (
                        <button
                          onClick={() => handleRetryJob(j.id)}
                          className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 border rounded font-medium"
                        >
                          Retry
                        </button>
                      )}
                      {(j.status === 'queued' || j.status === 'running') && (
                        <button
                          onClick={() => handleCancelJob(j.id)}
                          className="px-2 py-1 text-xs text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded font-medium"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteJob(j.id)}
                        disabled={deletingId === j.id}
                        className="px-2 py-1 text-xs text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-300 rounded font-medium transition-colors disabled:opacity-50"
                      >
                        {deletingId === j.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom Pagination Controls */}
        <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 pt-3 border-t">
          <div>
            Showing {jobs.length} of {jobPagination.total} jobs (Page {jobPagination.page} of {jobPagination.totalPages})
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setJobPage((p) => Math.max(1, p - 1))}
              disabled={jobPage <= 1}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 border rounded disabled:opacity-40 font-medium transition-colors"
            >
              ← Previous
            </button>
            <span className="font-mono text-slate-700">
              {jobPagination.page} / {jobPagination.totalPages}
            </span>
            <button
              onClick={() => setJobPage((p) => Math.min(jobPagination.totalPages, p + 1))}
              disabled={jobPage >= jobPagination.totalPages}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 border rounded disabled:opacity-40 font-medium transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      </section>

      {/* 3. ACCOUNTS TABLE */}
      {(() => {
        const filteredAccounts = accounts.filter((acc) =>
          acc.handle.toLowerCase().includes(accountSearch.toLowerCase().trim())
        );
        const totalAccountPages = Math.max(1, Math.ceil(filteredAccounts.length / accountsPerPage));
        const paginatedAccounts = filteredAccounts.slice(
          (accountPage - 1) * accountsPerPage,
          accountPage * accountsPerPage
        );

        return (
          <section className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">3. Ingested Accounts & Data Completeness</h2>
                <span className="text-xs text-slate-500">
                  Showing {paginatedAccounts.length} of {filteredAccounts.length} accounts (Page {accountPage} of {totalAccountPages})
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  placeholder="Filter by @handle..."
                  value={accountSearch}
                  onChange={(e) => {
                    setAccountSearch(e.target.value);
                    setAccountPage(1);
                  }}
                  className="px-3 py-1.5 text-xs border rounded-md focus:outline-none focus:ring-1 focus:ring-slate-500 w-48 font-mono"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-slate-600 font-medium">
                    <th className="p-3">Handle</th>
                    <th className="p-3">Followers</th>
                    <th className="p-3">Following</th>
                    <th className="p-3">Posts Collected</th>
                    <th className="p-3">Data Completeness Rate</th>
                    <th className="p-3">Last Scraped</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-slate-400">
                        {accountSearch ? 'No accounts match your filter.' : 'No accounts stored in database yet.'}
                      </td>
                    </tr>
                  ) : (
                    paginatedAccounts.map((acc) => (
                      <tr key={acc.id} className="border-b hover:bg-slate-50">
                        <td className="p-3 font-medium text-slate-900">
                          <a
                            href={`/admin/accounts/${acc.handle}`}
                            className="text-blue-600 hover:underline font-mono"
                          >
                            @{acc.handle}
                          </a>
                          {acc.is_verified && <span className="ml-1 text-blue-500">✓</span>}
                        </td>
                        <td className="p-3 font-mono text-xs">
                          {acc.followers_count?.toLocaleString() ?? 'NULL'}
                          <span className="text-slate-400 block text-[10px]">
                            [{acc.followers_source || 'NULL'}]
                          </span>
                        </td>
                        <td className="p-3 font-mono text-xs">
                          {acc.following_count?.toLocaleString() ?? 'NULL'}
                        </td>
                        <td className="p-3 font-mono text-xs">
                          {acc.total_posts_collected ?? 0}
                        </td>
                        <td className="p-3 text-xs">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className="font-semibold text-slate-700">
                                {acc.completeness?.overall_rate ?? 0}% overall
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Likes: {acc.completeness?.likes_rate ?? 0}% | Times: {acc.completeness?.timestamp_rate ?? 0}% | Captions: {acc.completeness?.caption_rate ?? 0}%
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-xs text-slate-500">
                          {acc.last_scraped_at
                            ? new Date(acc.last_scraped_at).toLocaleString()
                            : 'Never'}
                        </td>
                        <td className="p-3 text-right space-x-2">
                          <a
                            href={`/admin/accounts/${acc.handle}`}
                            className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 border rounded font-medium"
                          >
                            View Posts →
                          </a>
                          <button
                            onClick={() => handleDeleteAccount(acc.id, acc.handle)}
                            disabled={deletingId === acc.id}
                            className="px-2 py-1 text-xs text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-300 rounded font-medium transition-colors disabled:opacity-50"
                          >
                            {deletingId === acc.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalAccountPages > 1 && (
              <div className="flex justify-between items-center pt-3 border-t text-xs text-slate-600">
                <span>
                  Page {accountPage} of {totalAccountPages} ({filteredAccounts.length} creators)
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setAccountPage((p) => Math.max(1, p - 1))}
                    disabled={accountPage === 1}
                    className="px-3 py-1 border rounded bg-slate-50 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ← Previous
                  </button>
                  <span className="font-mono">{accountPage}</span>
                  <button
                    onClick={() => setAccountPage((p) => Math.min(totalAccountPages, p + 1))}
                    disabled={accountPage === totalAccountPages}
                    className="px-3 py-1 border rounded bg-slate-50 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </section>
        );
      })()}

      {/* 4. MODELS & PREDICTION */}
      <section className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">4. Machine Learning Models (LightGBM & Stacking)</h2>
          <p className="text-sm text-slate-600">
            Train Global Model across all accounts or Personal Model per account. Refuses to train if insufficient real rows exist.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={handleTrainGlobal}
            disabled={trainingGlobal}
            className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-medium hover:bg-black disabled:opacity-50"
          >
            {trainingGlobal ? 'Training Global Model...' : 'Train Global Model'}
          </button>

          <div className="flex items-center space-x-2">
            <select
              value={selectedAccountForTrain}
              onChange={(e) => setSelectedAccountForTrain(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded bg-white"
            >
              <option value="">Select Account for Personal Model...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.handle}>
                  @{a.handle} ({a.total_posts_collected} posts)
                </option>
              ))}
            </select>
            <button
              onClick={handleTrainPersonal}
              disabled={trainingPersonal || !selectedAccountForTrain}
              className="px-4 py-2 bg-slate-800 text-white rounded text-sm font-medium hover:bg-slate-900 disabled:opacity-50"
            >
              {trainingPersonal ? 'Training...' : 'Train Personal Model'}
            </button>
          </div>
        </div>

        {modelMsg && (
          <div
            className={`text-sm p-3 rounded ${
              modelMsg.includes('error') || modelMsg.includes('Error')
                ? 'bg-rose-50 text-rose-700'
                : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {modelMsg}
          </div>
        )}

        {/* Models Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-600 font-medium">
                <th className="p-3">Type</th>
                <th className="p-3">Target Account</th>
                <th className="p-3">Algorithm</th>
                <th className="p-3">Version</th>
                <th className="p-3">Rows Used</th>
                <th className="p-3">Metrics (MAE / R² / Spearman)</th>
                <th className="p-3">Trained At</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-slate-400">
                    No models trained yet. Click "Train Global Model" once enough data is ingested.
                  </td>
                </tr>
              ) : (
                models.map((m) => (
                  <tr key={m.id} className="border-b hover:bg-slate-50">
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                          m.model_type === 'global'
                            ? 'bg-neutral-900 text-white'
                            : 'bg-neutral-100 text-neutral-800 border border-neutral-300'
                        }`}
                      >
                        {m.model_type}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {m.accounts?.handle ? `@${m.accounts.handle}` : 'All Accounts'}
                    </td>
                    <td className="p-3 text-xs font-mono">{m.algorithm}</td>
                    <td className="p-3 text-xs font-mono">{m.version}</td>
                    <td className="p-3 text-xs font-mono">{m.training_rows_count}</td>
                    <td className="p-3 text-xs font-mono">
                      MAE: {m.metrics?.mae?.toFixed(4) ?? '-'} | R²: {m.metrics?.r2?.toFixed(3) ?? '-'} | ρ: {m.metrics?.spearman?.toFixed(3) ?? '-'}
                    </td>
                    <td className="p-3 text-xs text-slate-500">
                      {new Date(m.trained_at).toLocaleString()}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleDeleteModel(m.id, m.version)}
                        disabled={deletingId === m.id}
                        className="px-2 py-1 text-xs text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-300 rounded font-medium transition-colors disabled:opacity-50"
                      >
                        {deletingId === m.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Prediction Playground */}
        <div className="border-t pt-6 space-y-4">
          <h3 className="text-md font-semibold text-slate-800">Prediction Playground (/api/predict)</h3>
          <form onSubmit={handlePredict} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Target Account Handle</label>
              <input
                type="text"
                value={predHandle}
                onChange={(e) => setPredHandle(e.target.value)}
                placeholder="e.g. natgeo"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Media Type</label>
              <select
                value={predMediaType}
                onChange={(e) => setPredMediaType(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white"
              >
                <option value="image">Image</option>
                <option value="reel">Reel / Video</option>
                <option value="carousel">Carousel</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Draft Caption</label>
              <textarea
                rows={2}
                value={predCaption}
                onChange={(e) => setPredCaption(e.target.value)}
                placeholder="Write your draft caption with hashtags..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Planned Posting Date/Time (optional)</label>
              <input
                type="datetime-local"
                value={predTime}
                onChange={(e) => setPredTime(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={predLoading}
                className="w-full py-2 bg-slate-900 text-white rounded text-sm font-medium hover:bg-black disabled:opacity-50"
              >
                {predLoading ? 'Predicting...' : 'Predict Engagement Rate'}
              </button>
            </div>
          </form>

          {predResult && (
            <div className="p-4 bg-slate-100 rounded-lg border border-slate-200 text-sm space-y-2 font-mono">
              <div className="font-bold text-slate-900">
                Predicted Engagement Rate: {(predResult.predicted_engagement_rate * 100).toFixed(3)}%
              </div>
              <div className="text-xs text-slate-600">Model Used: {predResult.model_used}</div>
              <div className="text-xs text-slate-600">Note: {predResult.confidence_note}</div>
              {predResult.top_features && (
                <div className="text-xs text-slate-500">
                  Top Influencing Features: {JSON.stringify(predResult.top_features)}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 5. MODEL EVALUATION HARNESS */}
      <section className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">5. Model Evaluation Harness</h2>
            <p className="text-sm text-slate-500">
              Rigorous GroupKFold cross-validation against baselines on frozen dataset snapshots.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={evalSnapshot}
              onChange={(e) => setEvalSnapshot(e.target.value)}
              placeholder="Snapshot (e.g. 2026-11-02)"
              className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded w-36"
            />
            <button
              onClick={handleRunEvaluation}
              disabled={evalLoading}
              className="px-4 py-2 bg-slate-900 text-white rounded text-xs font-semibold hover:bg-black disabled:opacity-50 transition"
            >
              {evalLoading ? 'Running...' : 'Run Evaluation Harness'}
            </button>
          </div>
        </div>

        {evalMsg && (
          <div className="text-xs px-3 py-2 bg-blue-50 text-blue-700 rounded border border-blue-200 font-mono">
            {evalMsg}
          </div>
        )}

        {latestEval ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-3 bg-slate-50 border rounded text-xs">
                <span className="text-slate-500 block">Run ID</span>
                <span className="font-mono font-bold text-slate-800">{latestEval.run_id}</span>
              </div>
              <div className="p-3 bg-slate-50 border rounded text-xs">
                <span className="text-slate-500 block">Snapshot</span>
                <span className="font-mono font-bold text-slate-800">{latestEval.snapshot}</span>
              </div>
              <div className="p-3 bg-slate-50 border rounded text-xs">
                <span className="text-slate-500 block">Posts / Creators</span>
                <span className="font-mono font-bold text-slate-800">{latestEval.posts_count} / {latestEval.creators_count}</span>
              </div>
              <div className="p-3 bg-slate-50 border rounded text-xs">
                <span className="text-slate-500 block">Runtime</span>
                <span className="font-mono font-bold text-slate-800">{latestEval.runtime_s}s</span>
              </div>
            </div>

            {/* Benchmark Summary Table */}
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full text-xs text-left">
                <thead className="bg-slate-100 font-semibold text-slate-700 border-b">
                  <tr>
                    <th className="px-4 py-2.5">Model / Baseline</th>
                    <th className="px-4 py-2.5">MAE</th>
                    <th className="px-4 py-2.5">RMSE</th>
                    <th className="px-4 py-2.5">R²</th>
                    <th className="px-4 py-2.5">Overall Spearman</th>
                    <th className="px-4 py-2.5">Within-Account Spearman</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  <tr className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium">Global Mean Baseline</td>
                    <td className="px-4 py-2 font-mono">{latestEval.baselines?.global_mean?.mae?.toFixed(5)}</td>
                    <td className="px-4 py-2 font-mono">{latestEval.baselines?.global_mean?.rmse?.toFixed(5)}</td>
                    <td className="px-4 py-2 font-mono">{latestEval.baselines?.global_mean?.r2?.toFixed(4)}</td>
                    <td className="px-4 py-2 font-mono">{latestEval.baselines?.global_mean?.spearman?.toFixed(4)}</td>
                    <td className="px-4 py-2 font-mono">0.0000</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium">Follower Bucket Mean</td>
                    <td className="px-4 py-2 font-mono">{latestEval.baselines?.follower_bucket_mean?.mae?.toFixed(5)}</td>
                    <td className="px-4 py-2 font-mono">{latestEval.baselines?.follower_bucket_mean?.rmse?.toFixed(5)}</td>
                    <td className="px-4 py-2 font-mono">{latestEval.baselines?.follower_bucket_mean?.r2?.toFixed(4)}</td>
                    <td className="px-4 py-2 font-mono">{latestEval.baselines?.follower_bucket_mean?.spearman?.toFixed(4)}</td>
                    <td className="px-4 py-2 font-mono">0.0000</td>
                  </tr>
                  <tr className="bg-slate-50/80 font-bold text-slate-900 border-t">
                    <td className="px-4 py-2.5">Global LightGBM Model</td>
                    <td className="px-4 py-2.5 font-mono">{latestEval.global_model?.mae?.toFixed(5)}</td>
                    <td className="px-4 py-2.5 font-mono">{latestEval.global_model?.rmse?.toFixed(5)}</td>
                    <td className="px-4 py-2.5 font-mono">{latestEval.global_model?.r2?.toFixed(4)}</td>
                    <td className="px-4 py-2.5 font-mono">{latestEval.global_model?.spearman?.toFixed(4)}</td>
                    <td className="px-4 py-2.5 font-mono text-neutral-900 font-bold">{latestEval.global_model?.within_account_spearman?.toFixed(4)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Full Markdown Report Rendering */}
            {evalMarkdown && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Full Markdown Report Output:
                </div>
                <div className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-96">
                  {evalMarkdown}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded border border-dashed">
            No evaluation runs found yet. Click &quot;Run Evaluation Harness&quot; above to execute the 5-fold cross-validation.
          </div>
        )}
      </section>
    </div>
  );
}
