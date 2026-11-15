# Niche-Driven Trend Recommendation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a niche-aware trend recommendation engine that extracts a creator's true niche from post captions using the Gemini API, matches real-time online trends to that niche, and generates ready-to-publish post drafts with step-by-step next steps.

**Architecture:**
1. Backend Niche Extractor (`executeNicheAnalysis`): Reads post captions and bio, passes evidence to Gemini (`gemini-2.5-flash`), and extracts structured niche, sub-niche, pillars, language, and audience.
2. Backend Trend Matcher & Post Generator (`/api/recommendations/generate`): Ingests live Google Trends, feeds them with creator niche context into Gemini, filters out irrelevant trends, selects best-matching trends, and generates tailored recommendations with next steps, creation blueprints, and captions.
3. Web UI (`apps/web/src/app/recommendations/page.tsx`): Displays detected niche context, matched trend intelligence, step-by-step next steps, copyable ready-to-publish captions, and direct scheduling actions.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Express API, Google Gemini API (`@google/genai` / REST `gemini-2.5-flash`), Google Trends RSS.

---

## Global Constraints
- Do not hardcode API keys or secrets; read `GEMINI_API_KEY` and `LLM_PROVIDER` from environment.
- Gemini model calls must use active available models: `gemini-2.5-flash`, `gemini-1.5-flash`, or `gemini-flash-latest`.
- Remove any artificial `startsWith('AIzaSy')` prefix checks on Gemini API keys.
- Never crash if offline or if external APIs timeout: provide clean, structured fallbacks.
- Keep execution responsive: stream or timeout requests within 10 seconds.

## Review Focus
1. Gemini API key validation accepts keys with any prefix (including `AQ.`).
2. Accounts with sparse or zero captions gracefully report "Insufficient caption data" without breaking.
3. Trends selected for an account must genuinely relate to their detected niche (e.g., accounting/tax/business for finance, coding/software for tech).
4. Recommendation payload contains both the ready-to-post caption AND step-by-step next steps (blueprint).
5. Frontend renders clearly on desktop and mobile with one-click copy and schedule actions.

---

### Task 1: Fix Gemini API Configuration & Model Selection in Backend

**Files:**
- Modify: `apps/api/src/routes/onboarding.ts`
- Modify: `apps/api/src/routes/recommendations.ts`
- Test: `scripts/test_gemini_niche.ts`

- [ ] Remove `geminiApiKey.startsWith('AIzaSy')` restriction in `recommendations.ts` and `onboarding.ts`.
- [ ] Update candidate models list in both files to: `['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-flash-latest']`.
- [ ] Create test script `scripts/test_gemini_niche.ts` to verify direct Gemini API call returns valid structured JSON.
- [ ] Run test script and verify successful Gemini generation.

### Task 2: Implement Caption-Based Niche Extraction Engine

**Files:**
- Modify: `apps/api/src/routes/onboarding.ts`
- Modify: `apps/api/src/routes/accounts.ts`

- [ ] Ensure `executeNicheAnalysis` reads all captions from `storage/posts/${handle}.json`.
- [ ] Enhance prompt sent to Gemini with explicit instructions:
  - Extract primary niche, sub-niche, 3-4 content pillars, tone, target audience, and 5-10 core topic keywords.
  - Trace findings directly to quotes from post captions and hashtags.
- [ ] Persist extracted niche to `storage/niches/${handle}.json`.
- [ ] Verify niche extraction for `@tahirabbas_ca` and `@100xengineers` with real captions.

### Task 3: Build Niche-Grounded Trend Matching & Next-Steps Recommendation Generator

**Files:**
- Modify: `apps/api/src/routes/recommendations.ts`

- [ ] Update Google Trends fetcher to ingest multi-region trends (`US`, `GB`, `PK`, `IN`) and deduplicate.
- [ ] Update Gemini recommendation prompt in `recommendations.ts`:
  - Pass the creator's verified niche, content pillars, language, and the live Google Trends.
  - Require Gemini to evaluate trend relevance to the creator's niche.
  - If a general trend has a strong crossover angle, explain the connection clearly.
  - If general search trends are completely unrelated, select or synthesize high-impact trending topics in the creator's specific domain.
  - For each of 3 recommendations, generate:
    - `title`, `trend_topic`, `trend_source`, `niche_match_score` (85-99%)
    - `pillar`, `recommended_format`, `format_lift`, `optimal_posting_time`, `recommended_day`
    - `rationale` (why this trend connects to their niche)
    - `next_steps` (ordered 3-step action plan)
    - `creation_blueprint` (`hook`, `body`, `call_to_action`, `production_tips`)
    - `caption_draft` (complete, engaging caption in preferred language)
    - `suggested_hashtags` (5 niche & trend hashtags)
- [ ] Test endpoint `POST /api/recommendations/generate` with curl and verify returned JSON.

### Task 4: Revamp Recommendations Frontend Page

**Files:**
- Modify: `apps/web/src/app/recommendations/page.tsx`

- [ ] Update creator context header:
  - Show detected niche badge, content pillars, preferred language, and audience tier.
  - Add "Re-analyze Niche with AI" button.
- [ ] Add live trend ticker bar showing real-time trending topics.
- [ ] Redesign recommendation cards into a clean 3-column layout:
  - Header: Trend topic, Niche Match Score pill, Format badge, Lift metric.
  - Body: "Why This Trend Fits Your Niche" explanation.
  - "Next Steps & Blueprint": Collapsible or tabbed view showing Hook, 3-point Content Outline, Call-to-Action, and Production Tips.
  - "Ready-to-Post Draft": Formatted caption with hashtags, character count, and one-click "Copy Caption" button.
  - "Schedule Post": Action button pre-populating caption and date into Calendar.
  - "Feedback": Thumbs up/down buttons triggering `/api/recommendations/feedback`.

### Task 5: End-to-End Verification & Service Rebuild

**Files:**
- Test: `scripts/test_recommendations_flow.ts`

- [ ] Run end-to-end test script verifying niche extraction -> trend matching -> post draft output.
- [ ] Rebuild API (`pnpm --filter api build`) and Web frontend (`pnpm --filter web build`).
- [ ] Restart services via `run.sh` and verify live page on `http://localhost:3000/recommendations`.
