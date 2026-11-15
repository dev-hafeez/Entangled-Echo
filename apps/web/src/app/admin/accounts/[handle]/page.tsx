'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function getApiBase(): string {
  if (typeof window !== 'undefined') {
    const configuredApi = process.env.NEXT_PUBLIC_API_URL;
    if (configuredApi && !configuredApi.includes('localhost') && !configuredApi.includes('127.0.0.1')) {
      return configuredApi;
    }
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:4000`;
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
}

function getThumbnailSrc(post: any, apiBase: string): string | null {
  if (post.storage_paths && post.storage_paths.length > 0) {
    return `${apiBase}/api/media/image?path=${encodeURIComponent(post.storage_paths[0])}`;
  }
  if (post.media_urls && post.media_urls.length > 0) {
    return post.media_urls[0];
  }
  return null;
}

export default function AccountDetailPage() {
  const params = useParams();
  const handle = params.handle as string;

  const [account, setAccount] = useState<any>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apiBase, setApiBase] = useState('http://localhost:4000');
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    setApiBase(getApiBase());
  }, []);

  useEffect(() => {
    if (!handle) return;
    const load = async () => {
      try {
        setLoading(true);
        const [accRes, postRes] = await Promise.all([
          api.getAccount(handle),
          api.getAccountPosts(handle),
        ]);
        setAccount(accRes.account);
        setSnapshots(accRes.snapshots || []);
        setPosts(postRes.posts || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load account details');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [handle]);

  if (loading) {
    return <div className="p-12 text-center text-slate-500">Loading @{handle}...</div>;
  }

  if (error || !account) {
    return (
      <div className="p-8 text-center text-red-600">
        <p className="font-semibold">{error || 'Account not found'}</p>
        <a href="/admin" className="text-sm text-blue-600 underline mt-4 inline-block">
          ← Back to Admin
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <a href="/admin" className="text-sm font-medium text-slate-500 hover:text-black mb-3 inline-block">
          ← Back to Admin Dashboard
        </a>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">@{account.handle}</h1>
          <span className="text-xs bg-slate-200 px-2 py-1 rounded font-mono">
            ID: {account.id}
          </span>
        </div>
      </div>

      {/* PROFILE DETAILS CARD */}
      <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="flex items-start space-x-4 col-span-1 md:col-span-2">
          <div className="flex-shrink-0">
            {!avatarFailed ? (
              <img
                src={account.avatar_url || `${apiBase}/api/media/avatar?handle=${encodeURIComponent(account.handle)}`}
                alt={account.handle}
                className="w-16 h-16 rounded-full object-cover border"
                onError={(e) => {
                  const fallback = `${apiBase}/api/media/avatar?handle=${encodeURIComponent(account.handle)}`;
                  if (e.currentTarget.src !== fallback) {
                    e.currentTarget.src = fallback;
                  } else {
                    setAvatarFailed(true);
                  }
                }}
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-[#373E3E] text-white border flex items-center justify-center font-bold text-xl uppercase font-mono shadow-sm">
                {account.handle?.slice(0, 2).toUpperCase() || '?'}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-800 flex items-center">
              {account.full_name || `@${account.handle}`}
              {account.is_verified && <span className="ml-1 text-blue-500">✓</span>}
            </h2>
            <p className="text-sm text-slate-600 whitespace-pre-line">{account.bio || 'No bio provided'}</p>
            {account.external_link && (
              <a
                href={account.external_link}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 hover:underline block"
              >
                🔗 {account.external_link}
              </a>
            )}
            <div className="flex gap-2 pt-2 text-xs text-slate-500">
              {account.category && <span>Category: {account.category}</span>}
              {account.is_business && <span>• Business Account</span>}
            </div>
          </div>
        </div>

        <div className="bg-slate-50 p-4 rounded border text-sm space-y-2 font-mono">
          <div className="flex justify-between">
            <span className="text-slate-500">Followers:</span>
            <span className="font-semibold">
              {account.followers_count?.toLocaleString() ?? 'NULL'}
            </span>
          </div>
          <div className="text-[11px] text-right text-slate-400">
            Source: {account.followers_source || 'NULL'} ({account.followers_precision || 'exact'})
          </div>

          <div className="flex justify-between border-t pt-2">
            <span className="text-slate-500">Following:</span>
            <span className="font-semibold">
              {account.following_count?.toLocaleString() ?? 'NULL'}
            </span>
          </div>
          <div className="text-[11px] text-right text-slate-400">
            Source: {account.following_source || 'NULL'}
          </div>

          <div className="flex justify-between border-t pt-2">
            <span className="text-slate-500">Posts Count:</span>
            <span className="font-semibold">
              {account.posts_count?.toLocaleString() ?? 'NULL'}
            </span>
          </div>
          <div className="text-[11px] text-right text-slate-400">
            Source: {account.posts_count_source || 'NULL'}
          </div>
        </div>
      </div>

      {/* POSTS GRID */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">
            Collected Posts ({posts.length})
          </h2>
          <span className="text-xs text-slate-500">
            Showing all scraped posts with visual thumbnails and explicit companion sources
          </span>
        </div>

        {posts.length === 0 ? (
          <div className="p-8 text-center bg-white border rounded text-slate-400">
            No posts collected for this account yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => {
              const thumbnail = getThumbnailSrc(post, apiBase);
              const likesCount =
                post.likes_count ??
                post.likesCount ??
                post.post_snapshots?.[0]?.likes_count ??
                null;
              const likesSource =
                post.likes_source ??
                post.likesSource ??
                post.post_snapshots?.[0]?.likes_source ??
                (likesCount != null ? 'network_json' : null);
              const commentsCount =
                post.comments_count ??
                post.commentsCount ??
                post.post_snapshots?.[0]?.comments_count ??
                null;
              const commentsSource =
                post.comments_source ??
                post.commentsSource ??
                post.post_snapshots?.[0]?.comments_source ??
                (commentsCount != null ? 'network_json' : null);
              const viewsCount =
                post.views_count ??
                post.viewsCount ??
                post.post_snapshots?.[0]?.views_count ??
                null;
              const viewsSource =
                post.views_source ??
                post.viewsSource ??
                post.post_snapshots?.[0]?.views_source ??
                null;

              return (
                <div
                  key={post.id}
                  className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow"
                >
                  {/* Visual Image / Thumbnail Preview */}
                  <div className="relative aspect-square w-full bg-slate-100 overflow-hidden border-b flex items-center justify-center">
                    {thumbnail ? (
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full h-full block group relative"
                      >
                        <img
                          src={thumbnail}
                          alt={`Post #${post.shortcode}`}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          onError={(e) => {
                            const currentSrc = e.currentTarget.src;
                            const externalFallback = post.media_urls?.[0];
                            if (externalFallback && currentSrc !== externalFallback) {
                              e.currentTarget.src = externalFallback;
                            } else {
                              e.currentTarget.style.display = 'none';
                              const fallbackBox = e.currentTarget.parentElement?.querySelector('.post-media-fallback');
                              if (fallbackBox) {
                                (fallbackBox as HTMLElement).style.display = 'flex';
                              }
                            }
                          }}
                        />
                        <div className="post-media-fallback hidden absolute inset-0 text-slate-400 text-xs font-mono flex-col items-center justify-center p-3 text-center bg-slate-100">
                          <span className="font-semibold text-slate-600 mb-1">Preview Unavailable</span>
                          <span className="text-[10px] text-slate-400">#{post.shortcode}</span>
                        </div>
                      </a>
                    ) : (
                      <div className="text-slate-400 text-xs font-mono flex flex-col items-center justify-center p-3 text-center bg-slate-100 w-full h-full">
                        <span className="font-semibold text-slate-600 mb-1">No Image Cached</span>
                        <span className="text-[10px] text-slate-400">#{post.shortcode}</span>
                      </div>
                    )}

                    {/* Media Type & Carousel Badge */}
                    <div className="absolute top-2 right-2 pointer-events-none">
                      <span className="bg-black/75 backdrop-blur-xs text-white px-2 py-0.5 rounded text-[10px] font-semibold uppercase font-mono tracking-wider shadow">
                        {post.media_type || 'image'}
                        {post.carousel_size ? ` (${post.carousel_size})` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-mono font-medium text-slate-700">
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          #{post.shortcode} ↗
                        </a>
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {post.posted_at ? new Date(post.posted_at).toLocaleDateString() : 'NULL date'}
                      </span>
                    </div>

                    {/* Caption */}
                    <p className="text-xs text-slate-700 line-clamp-3 whitespace-pre-line font-sans">
                      {post.caption || <span className="text-slate-400 italic font-mono">NULL (no caption)</span>}
                    </p>

                    {/* Hashtags */}
                    {post.hashtags && post.hashtags.length > 0 && (
                      <div className="flex flex-wrap gap-1 text-[11px] text-blue-600 font-mono">
                        {post.hashtags.map((h: string) => (
                          <span key={h}>#{h}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Metrics Breakdown with Companion Sources */}
                  <div className="bg-slate-50 p-4 border-t text-xs font-mono space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Likes:</span>
                      <div className="text-right">
                        <span className="font-bold text-slate-800">
                          {likesCount != null ? likesCount.toLocaleString() : 'NULL'}
                        </span>
                        <span className="ml-1 text-[10px] text-slate-400">
                          [{likesSource || 'NULL'}]
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Comments:</span>
                      <div className="text-right">
                        <span className="font-bold text-slate-800">
                          {commentsCount != null ? commentsCount.toLocaleString() : 'NULL'}
                        </span>
                        <span className="ml-1 text-[10px] text-slate-400">
                          [{commentsSource || 'NULL'}]
                        </span>
                      </div>
                    </div>

                    {viewsCount != null && (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Views (Reels):</span>
                        <div className="text-right">
                          <span className="font-bold text-slate-800">
                            {viewsCount.toLocaleString()}
                          </span>
                          <span className="ml-1 text-[10px] text-slate-400">
                            [{viewsSource || 'NULL'}]
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-between items-center border-t pt-1">
                      <span className="text-slate-500">Upload Date:</span>
                      <div className="text-right">
                        <span className="text-slate-700">
                          {post.posted_at ? new Date(post.posted_at).toLocaleDateString() : 'NULL'}
                        </span>
                        <span className="ml-1 text-[10px] text-slate-400">
                          [{post.posted_at_source || 'NULL'}]
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
