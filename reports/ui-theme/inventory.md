# UI Theme Inventory & Token Audit

Generated: 2026-11-17T16:46:00+05:00
Branch: `ui-theme-dashboard-recs-calendar-notifications-settings`

---

## 1. Route Files & Imports Inventory

| Route | File Path | Imported Modules / Libraries | Subcomponents |
|---|---|---|---|
| **Shared Layout** | `apps/web/src/app/layout.tsx` | `./globals.css`, `react`, `@clerk/nextjs`, `next/navigation` | `NavigationHeader`, `RootLayout` |
| **Dashboard** | `apps/web/src/app/dashboard/page.tsx` | `react`, `next/link`, `@clerk/nextjs`, `@/lib/api`, `recharts`, `lucide-react` | Self-contained within `DashboardPage` |
| **AI Recommendations** | `apps/web/src/app/recommendations/page.tsx` | `react`, `@clerk/nextjs`, `next/link`, `lucide-react`, `@/lib/api` | Self-contained within `RecommendationsPage` |
| **Calendar** | `apps/web/src/app/calendar/page.tsx` | `react`, `@clerk/nextjs`, `@/lib/api`, `lucide-react` | Self-contained within `CalendarPage` |
| **Notifications** | `apps/web/src/app/notifications/page.tsx` | `react`, `@clerk/nextjs`, `next/link`, `@/lib/api`, `lucide-react` | Self-contained within `NotificationsPage` |
| **Settings** | `apps/web/src/app/settings/page.tsx` | `react`, `@clerk/nextjs` | Self-contained within `SettingsPage` |

*Note: None of the five pages import external components from `src/components`. All UI elements are rendered directly in the respective page files.*

---

## 2. Git Status & Diff Against Main

Command: `git diff --stat main`
Output:
```
(empty - 0 files changed, 0 insertions, 0 deletions)
```

Working branch is cleanly branched from `main`.

---

## 3. Existing Theme Tokens

### Tailwind Configuration (`apps/web/tailwind.config.js`)
- **Colors**:
  - `primary`: `#373E3E`
  - Default Tailwind palette: `slate`, `emerald`, `amber`, `rose`, `blue`, `purple` (to be replaced with warm neutrals/greens per design system guidelines).
- **Fonts**:
  - System font stack defined in `globals.css`: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.
- **Border Radius**:
  - Tailwind default radii (`rounded-md` 6px, `rounded-lg` 8px, `rounded-xl` 12px, `rounded-2xl` 16px, `rounded-full` 9999px).
- **Shadows**:
  - Tailwind default shadows (`shadow-sm`, `shadow`, `shadow-md`, `shadow-lg`).

### Design System Color Palette for Theme Upgrade
As specified by the prompt guidelines:
- **Warm white / cream surfaces**: `#fdfcf9`, `#fbfaf8`, `#f7f6f2`, `#ffffff`
- **Dark forest-green headings / elements**: `#1b3026`, `#20372d`, `#285a49`
- **Sage backgrounds & borders**: `#eef3ec`, `#e6ede3`, `#d8e2d4`
- **Fresh-green accents for active states**: `#285a49`, `#347761`, `#409176` (light active tint: `#eef6eb`, border `#cbe2c5`)
- **Muted grey secondary text**: `#667069`, `#78847c`
- **Thin borders**: `#e5e9e2`, `#ecefe9`, `#dde3d9`
- **Buttons**:
  - Dark background (`bg-[#20372d] text-white`)
  - Hover: white background with dark text and dark border (`hover:bg-white hover:text-[#20372d] hover:border-[#20372d]`)
  - Focus ring: `focus-visible:ring-2 focus-visible:ring-[#285a49]`
- **Strict prohibitions**:
  - No emoji (replace existing with SVGs / Lucide icons or clean text tags).
  - No purple (replace all purple classes with forest/sage/emerald tones).
  - No new animations; respect `prefers-reduced-motion`.

---

## 4. Pre-Edit Baseline Screenshots

Saved to `reports/ui-theme/screenshots/`:
- `dashboard-before-1440.png` (1440px desktop)
- `dashboard-before-390.png` (390px mobile)
- `recommendations-before-1440.png` (1440px desktop)
- `recommendations-before-390.png` (390px mobile)
- `calendar-before-1440.png` (1440px desktop)
- `calendar-before-390.png` (390px mobile)
- `notifications-before-1440.png` (1440px desktop)
- `notifications-before-390.png` (390px mobile)
- `settings-before-1440.png` (1440px desktop)
- `settings-before-390.png` (390px mobile)
