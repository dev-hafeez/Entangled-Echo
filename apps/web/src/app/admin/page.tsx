'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Scraper Form
  const [targetsText, setTargetsText] = useState('');
  const [maxPosts, setMaxPosts] = useState<string>('12');
  const [headless, setHeadless] = useState<boolean>(true);
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState('');

  // Data
  const [jobs, setJobs] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);

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

  // Check auth
  useEffect(() => {
    const isAuth = document.cookie.includes('admin_auth=true');
    setIsAuthenticated(isAuth);
  }, []);

  // Fetch data
  const loadData = async () => {
    try {
      const [jRes, aRes, mRes] = await Promise.allSettled([
        api.getJobs(),
        api.getAccounts(),
        api.getModels(),
      ]);

      if (jRes.status === 'fulfilled') setJobs(jRes.value.jobs || []);
      if (aRes.status === 'fulfilled') setAccounts(aRes.value.accounts || []);
      if (mRes.status === 'fulfilled') setModels(mRes.value.models || []);
    } catch (e) {
      console.error('Failed to load admin data:', e);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
      const interval = setInterval(loadData, 5000); // Polling every 5s for job updates
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setIsAuthenticated(true);
      } else {
        setAuthError('Invalid administrator password');
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
      <div className="flex justify-between items-center border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">EntangledEcho Admin Console</h1>
          <p className="text-sm text-slate-500">Instagram Scraper, Job Queue, and ML Engine</p>
        </div>
        <button
          onClick={loadData}
          className="text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 px-3 py-1.5 rounded font-medium"
        >
          ↻ Refresh Data
        </button>
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
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-slate-800">2. Scrape Jobs Queue</h2>
          <span className="text-xs text-slate-500">{jobs.length} jobs in queue</span>
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
                          className="px-2 py-1 text-xs text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded font-medium"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. ACCOUNTS TABLE */}
      <section className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-slate-800">3. Ingested Accounts & Data Completeness</h2>
          <span className="text-xs text-slate-500">{accounts.length} accounts in database</span>
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
                <th className="p-3 text-right">View</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-slate-400">
                    No accounts stored in database yet.
                  </td>
                </tr>
              ) : (
                accounts.map((acc) => (
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
                    <td className="p-3 text-right">
                      <a
                        href={`/admin/accounts/${acc.handle}`}
                        className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 border rounded font-medium"
                      >
                        View Posts Grid →
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

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
              </tr>
            </thead>
            <tbody>
              {models.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-slate-400">
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
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-blue-100 text-blue-800'
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
    </div>
  );
}
