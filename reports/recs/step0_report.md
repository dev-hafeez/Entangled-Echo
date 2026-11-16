# Step 0 - Current Recommendation Output & Defect Analysis

## 1. Raw Output Files Saved
- `reports/recs/before/cristiano.json`
- `reports/recs/before/kaleem._.abbasi830.json`
- `reports/recs/before/100xengineers.json`

## 2. Identified Off-Niche Topics
All three creators, despite vastly different declared niches and caption histories, received the exact same three generic Google search trends:
1. `us employment based green card proposal`
2. `snl sister sketch`
3. `microsoft outlook global outage causes`

### Discrepancy per Creator:
- **@cristiano** (Niche: *Professional Football & Athlete Lifestyle*, Pillars: *Match Performance & Highlights*, *Fitness & Athletic Training*, *Personal Brand & Partnerships*, *Team & Championship Milestones*):
  - Received: `us employment based green card proposal`, `snl sister sketch`, `microsoft outlook global outage causes`.
  - None of these topics exist in Cristiano's niche, content pillars, or caption history.
  - Caption generated: *"Em foco hoje: microsoft outlook global outage causes. Uma análise direta e necessária sobre como isso impacta nosso dia a dia. Deixe sua opinião nos comentários abaixo! 👇⚽️"*
- **@kaleem._.abbasi830** (Niche: *Aesthetic Photography & Motorcycle Culture*, Pillars: *Scenic & Aesthetic Imagery*, *Motorcycle & Travel Collaborations*, *Poetic Personal Reflections*):
  - Received: `us employment based green card proposal`, `snl sister sketch`, `microsoft outlook global outage causes`.
  - None of these topics exist in Kaleem's niche, motorcycle photography pillars, or caption history.
  - Caption generated: Urdu Arabic script asking viewers to save a post regarding `microsoft outlook global outage causes` for motorcycle culture.
- **@100xengineers** (Niche: *AI Literacy, EdTech & Developer Education*, Pillars: *Applied AI Tutorials*, *Builder Community Cohorts*, *AI Literacy & Career Growth*, *Engineering Frameworks*):
  - Received: `us employment based green card proposal`, `snl sister sketch`.
  - `snl sister sketch` and US green cards have zero overlap with developer education, programming tutorials, or AI literacy.

## 3. Code Path Letting Off-Niche Topics Through
In `apps/api/src/routes/recommendations.ts` on `main`:
1. Lines 405-414: When external LLM call is bypassed or fails (`canUseGemini` false or error), execution falls through to line 516: `// 7. Deterministic Instant Offline Fallback with Live Google Trends`.
2. Lines 517-522:
   ```typescript
   const filteredLiveTrends = liveTrends.filter(
     (t) => !userPrefs.dislikedTopics.some((dt) => t.title.toLowerCase().includes(dt.toLowerCase()))
   );
   const candidateTrends = filteredLiveTrends.length >= 3 ? filteredLiveTrends : liveTrends;
   const topTrends = candidateTrends.slice(0, 3);
   ```
   **Defect**: `liveTrends` contains whatever random RSS items Google Trends returned. `candidateTrends.slice(0, 3)` slices the top 3 trends without ANY semantic similarity calculation, keyword overlap check, or niche relevance filtering.
3. Lines 528-560: Each trend from `fallbackTrends.slice(0, 3)` is unconditionally mapped into a recommendation with a hardcoded `niche_match_score` (e.g. `95 - idx * 4`) and forced into a static template string:
   `caption_draft: generateLocalizedCaption(userLanguage, trend.title, userNiche, idx + 1)`
