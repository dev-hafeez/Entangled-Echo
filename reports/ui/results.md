# Step 5 — UI Tests and Verification Results

**Date**: 2026-11-17  
**Branch**: `ui-landing-and-dashboard`  
**Base Commit**: `4dde450` (`main`)  

---

## 1. Build & Type Checking Checks

| Command | Exit Code | Status | Details |
|---|---|---|---|
| `pnpm --filter web exec tsc --noEmit` | **0** | **PASSED** | Clean TypeScript compilation across entire `apps/web` project |
| `pnpm --filter web build` | **0** | **PASSED** | Optimized production Next.js build created; 14 static pages generated |

---

## 2. Screenshot Evidence

All screenshots captured via Playwright Chromium headless engine across desktop (1440px) and mobile (390px) viewports:

| Viewport | Route & Scenario | Screenshot File Path |
|---|---|---|
| 1440px | Landing Page (`/`, signed-out) | `reports/ui/screenshots/landing_1440.png` |
| 390px | Landing Page (`/`, signed-out) | `reports/ui/screenshots/landing_390.png` |
| 1440px | Dashboard (`/dashboard?handle=cristiano`, with post images) | `reports/ui/screenshots/dashboard_1440.png` |
| 390px | Dashboard (`/dashboard?handle=cristiano`, with post images) | `reports/ui/screenshots/dashboard_390.png` |
| 1440px | Dashboard (`/dashboard?handle=rondarousey`, fallback "Image unavailable") | `reports/ui/screenshots/dashboard_no_image_1440.png` |
| 390px | Dashboard (`/dashboard?handle=rondarousey`, fallback "Image unavailable") | `reports/ui/screenshots/dashboard_no_image_390.png` |

---

## 3. Hover States Verification

Verified programmatically using Playwright `getComputedStyle`:

### 3.1 Button Hover State
- **Rule**: Black background with white text; on hover, white background with black text and black border.
- **Computed CSS Values**:
  - **Before Hover**:
    - `backgroundColor`: `rgb(0, 0, 0)`
    - `color`: `rgb(255, 255, 255)`
    - `borderTopColor`: `rgb(0, 0, 0)`
    - `borderTopWidth`: `1px`
  - **After Hover**:
    - `backgroundColor`: `rgb(255, 255, 255)`
    - `color`: `rgb(0, 0, 0)`
    - `borderTopColor`: `rgb(0, 0, 0)`
    - `borderTopWidth`: `1px`
- **Verdict**: **PASSED** (Exact inverse transition with persistent 1px black border)

### 3.2 Card Hover State
- **Rule**: Cards grow and get a shadow on hover (`hover:scale-[1.02] hover:shadow-lg`).
- **Computed CSS Values**:
  - **Before Hover**:
    - `transform`: `none`
    - `boxShadow`: `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px`
  - **After Hover**:
    - `transform`: `matrix(1.02, 0, 0, 1.02, 0, 0)` (1.02x scale)
    - `boxShadow`: `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.1) 0px 10px 15px -3px, rgba(0, 0, 0, 0.1) 0px 4px 6px -4px` (Tailwind `shadow-lg`)
- **Verdict**: **PASSED**

---

## 4. Mobile Responsiveness & Horizontal Scroll Check (390px Viewport)

Evaluated via `document.documentElement.scrollWidth <= window.innerWidth`:

| Test Target | `scrollWidth` | `innerWidth` | No Horizontal Scroll (`<= 390`) | 16px Side Gutter |
|---|---|---|---|---|
| Landing Page (`/`) | **390px** | **390px** | **TRUE** | `px-4` (16px) |
| Dashboard (`@cristiano`) | **390px** | **390px** | **TRUE** | `px-4` (16px) |
| Dashboard (`@rondarousey`) | **390px** | **390px** | **TRUE** | `px-4` (16px) |

- **Verdict**: **PASSED** (Zero horizontal overflow on mobile screens; cards reflow down to 1 column).

---

## 5. Items Not Built / Scraper Limitations

1. **Scraper Automatic Image Downloading**:
   - The scraper does not automatically download post image media during live scraping; it stores metadata and external Instagram CDN URLs. Existing local post media in `storage/post-media/<handle>/<shortcode>/0.jpg` is served via the new API endpoint `/api/media/image?path=...`.
   - In accordance with the prompt ("Do NOT write scraper code"), no modifications were made to the scraper pipeline.
2. **Avatar CDN Expiration**:
   - Instagram avatar URLs in `storage/profiles/*.json` are ephemeral Meta CDN URLs. If an account has an expired URL, the download attempt in `/api/media/avatar` returns a 404, causing the UI to gracefully display the fallback initial avatar (e.g. `C` for Cristiano Ronaldo, `R` for Ronda Rousey) with background color `#373E3E`.
