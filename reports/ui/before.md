# Step 0 — UI Current State Report

Date: 2026-11-16
Branch: `ui-landing-and-dashboard`

---

## 1. Routes & Route Groups in `apps/web/src/app/`

### Route Files:
- `/` &rarr; `apps/web/src/app/page.tsx`
- `/dashboard` &rarr; `apps/web/src/app/dashboard/page.tsx`
- `/calendar` &rarr; `apps/web/src/app/calendar/page.tsx`
- `/recommendations` &rarr; `apps/web/src/app/recommendations/page.tsx`
- `/notifications` &rarr; `apps/web/src/app/notifications/page.tsx`
- `/settings` &rarr; `apps/web/src/app/settings/page.tsx`
- `/admin` &rarr; `apps/web/src/app/admin/page.tsx`
- `/admin/accounts/[handle]` &rarr; `apps/web/src/app/admin/accounts/[handle]/page.tsx`
- `/login` &rarr; `apps/web/src/app/login/page.tsx`
- `/signup` &rarr; `apps/web/src/app/signup/page.tsx`
- `/sign-in/[[...sign-in]]` &rarr; `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx`
- `/sign-up/[[...sign-up]]` &rarr; `apps/web/src/app/sign-up/[[...sign-up]]/page.tsx`
- `/api/auth/login` &rarr; `apps/web/src/app/api/auth/login/route.ts`
- `/api/auth/logout` &rarr; `apps/web/src/app/api/auth/logout/route.ts`

### Route Groups:
- Currently, there are **no active parenthesis route groups** (such as `(dashboard)` or `(auth)`) on `main`.
- The dashboard is located directly at `apps/web/src/app/dashboard/page.tsx`.

### File Serving "/":
- `apps/web/src/app/page.tsx` currently serves `/`.
- Current implementation:
  ```typescript
  import { redirect } from 'next/navigation';

  export default function Home() {
    redirect('/admin');
  }
  ```
  It unconditionally redirects all visitors to `/admin`.

---

## 2. Profile Data Ingestion in Dashboard

### Source:
In `apps/web/src/app/dashboard/page.tsx`:
- `profile` state is populated via `api.getAccount(clean)` calling `GET /api/accounts/:handle`.
- Profile data is read from `storage/profiles/<handle>.json` or Supabase `accounts` table.

### Fields present on `profile`:
- `handle`: string (e.g., `"100xengineers"`)
- `full_name`: string | null (e.g., `"100xEngineers"`)
- `bio`: string | null (multiline text, e.g., `"🦾 AI Literacy and Education\n..."`)
- `avatar_url`: string | null (external Instagram CDN URL, e.g., `"https://scontent.cdninstagram.com/..."`)
- `followers_count`: number
- `following_count`: number
- `posts_count`: number
- `is_verified`: boolean
- `external_link`: string | null

### Stored Profile Picture Status:
- The scraped profiles in `storage/profiles/*.json` only contain `avatar_url` pointing to external Instagram CDN hosts.
- No local avatar path field currently exists on the account schema.
- Hotlinking directly to `avatar_url` risks broken images due to Meta's ephemeral CDN URL expiration (`oe=...`).
- A server-side image download and caching step (`/api/media/avatar?handle=<handle>`) is needed so profile pictures are served from local stored copies instead of external URLs.

---

## 3. Post Data & Media URLs

### Source:
In `apps/web/src/app/dashboard/page.tsx`:
- `posts` state is populated via `api.getAccountPosts(clean)` calling `GET /api/accounts/:handle/posts`.
- Posts are read from `storage/posts/<handle>.json`.

### Fields present on each `post` object:
- `id`: string (e.g., `"local-abdulelsayed-DfLc3M1ALwR"`)
- `shortcode`: string (e.g., `"DfLc3M1ALwR"`)
- `url`: string (e.g., `"https://www.instagram.com/p/DfLc3M1ALwR/"`)
- `media_type`: `'image' | 'video' | 'carousel'`
- `caption`: string
- `posted_at`: string | null (ISO timestamp)
- `likes_count`: number | null
- `comments_count`: number | null
- `views_count`: number | null
- `storage_paths`: string[] (e.g., `["abdulelsayed/DfLc3M1ALwR/0.jpg"]`)
- `media_urls`: string[] (external CDN URLs)

### Current Image Rendering in Dashboard:
- `apps/web/src/app/dashboard/page.tsx` currently renders **zero images** for posts (lines 988–1034 only display date, media type badge, text caption, likes, comments, and external link).
- The media endpoint `GET /api/media/image?path=...` in `apps/api/src/routes/media.ts` only attempted downloads from Supabase storage, failing with 404 for media stored in `storage/post-media/<handle>/<shortcode>/0.jpg`.
- To fulfill Step 4, `apps/api/src/routes/media.ts` must fall back to local disk storage (`storage/post-media/<path>`), and the dashboard cards must render the stored image with fallback to a neutral placeholder with `"Image unavailable"`.
