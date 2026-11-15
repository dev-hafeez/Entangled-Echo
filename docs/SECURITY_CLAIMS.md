# EntangledEcho Security Claims Matrix

This document defines the verified security boundaries of the EntangledEcho application following Step 2.2 hardening. Every claim in this matrix is strictly supported by automated test suites and reproducible test executions conducted on branch `security-step-2.2-clean`.

Claims not listed here (e.g., "immune to all attacks", "production-ready", "live Clerk JWKS verified", "live Meta OAuth verified") are **explicitly excluded**.

---

## 1. Verified Security Claims Matrix

| # | Verified Claim | Evidence (Test & Commit) | What is NOT Covered |
| :--- | :--- | :--- | :--- |
| **C1** | **Admin Token Leakage Prevention**: Next.js login endpoint `POST /api/auth/login` returns `{ success: true }` only and does not expose `admin_session_token` in response body. Session authenticated exclusively via `HttpOnly`, `SameSite: Lax` cookie. | Commit: `52f1523`, `6ce446d`<br>Test: `scripts/test_proxy_security_after.ts` (Group 1: Login Body Does Not Expose Admin Session Token) | Physical device compromise, browser memory inspection, or non-Next.js route handlers outside the application boundary. |
| **C2** | **Proxy Path Allowlist & Privilege Escalation**: Next.js proxy route `apps/web/src/app/api/proxy/[...path]` rejects non-allowlisted routes (default deny) and prevents non-admin callers from accessing `/api/admin/*`, `/api/jobs/*`, `/api/models/*`, `/api/session/*`, `/api/calendar/tick`, and `/internal/tick`. | Commit: `52f1523`<br>Test: `scripts/test_proxy_security_after.ts` (Group 2: Proxy Path Allowlist & Privilege Escalation) | Direct network access to Express API on port 5001 if deployed without network isolation from the public internet. |
| **C3** | **Header Stripping & Cookie Forwarding**: Reverse proxy strips client-supplied `Authorization`, `x-admin-password`, `x-forwarded-*`, and arbitrary `Cookie` headers, injecting only the verified server-side `admin_session` cookie. | Commit: `52f1523`<br>Test: `scripts/test_proxy_security_after.ts` (Group 3: Header Stripping & Admin Cookie Forwarding) | Malicious or malformed payload bodies submitted to otherwise allowable public proxy paths. |
| **C4** | **Live Admin Proxy Forwarding**: Valid admin session cookie enables successful 200 OK forwarding through Next.js proxy to live Express API (`GET /api/proxy/api/admin/status`). Missing or tampered cookies return 403 Forbidden with zero upstream secret leakage. | Commit: `4ad7c64`, `6ce446d`<br>Test: `scripts/test_proxy_security_after.ts` (Group 5: Real Express Admin Request Through Proxy) | Clerk user-level proxying (user routes authenticate via direct Bearer tokens verified by `@clerk/backend`). |
| **C5** | **Onboarding Handle Uniqueness**: `POST /api/onboarding/user-profile` verifies handle ownership across all existing user sessions; duplicate claims return `409 Conflict`. | Commit: `742fa68`<br>Test: `scripts/test_task2_uniqueness.ts` (Step 2: Onboarding Uniqueness Rejection), `scripts/test_clerk_auth.ts` (Suite 9: Onboarding rejects handle claimed by another user) | Cross-platform collisions where the same handle exists on multiple distinct social platforms without platform qualification. |
| **C6** | **Handle Normalization (Homoglyph & Case Spoofing)**: Social handle lookups apply Unicode NFKC normalization, strip leading `@`, and lowercase ASCII characters, defeating visual spoofing and case confusion attacks. | Commit: `742fa68`<br>Test: `scripts/test_task2_uniqueness.ts` (Step 1: Handle Normalization Integrity), `scripts/test_clerk_auth.ts` (Suite 9: Handle normalization collapses case and Unicode homoglyphs) | Homoglyphs from non-decomposable Unicode scripts (e.g. Cyrillic characters that visually resemble Latin letters without NFKC decomposition). |
| **C7** | **Social Account Cross-Tenant Isolation**: Scheduling posts (`POST /api/calendar/posts`), submitting recommendation feedback (`POST /api/recommendations/feedback`), and generating recommendations (`POST /api/recommendations/generate`) require caller to own the handle or hold admin privileges. | Commit: `742fa68`<br>Test: `scripts/test_task2_uniqueness.ts` (Step 3: Ownership Enforcement), `scripts/test_clerk_auth.ts` (Suite 7 & Suite 9) | Multi-user collaboration / delegated permissions for shared brand management across multiple creator accounts. |
| **C8** | **Account Deletion Authorization**: `DELETE /api/accounts/:idOrHandle` requires verified administrator credentials; regular authenticated users and anonymous callers receive 403 Forbidden. | Commit: `c612d6d`<br>Test: `scripts/test_clerk_auth.ts` (Suite 10: Account deletion requires admin) | Rate limiting on repeated administrative deletion requests. |
| **C9** | **Internal Tick Secret Enforcement & Fail-Closed**: `POST /internal/tick` and `/api/calendar/tick` require a valid `INTERNAL_TICK_SECRET`. When the secret is unconfigured, endpoints fail closed with exact `503 Service Unavailable`. Unauthorized calls return `401 Unauthorized`. | Commit: `c612d6d`<br>Test: `scripts/test_clerk_auth.ts` (Suite 10: Internal tick secret enforcement, ticker fail-closed) | External scheduler infrastructure (e.g. cron daemon security or cloud provider scheduler configuration). |
| **C10** | **Calendar Post Cross-Tenant Protection**: `PATCH /api/calendar/posts/:id` strictly prevents modifying post ownership or assigning posts to another user's account handle. | Commit: `c612d6d`<br>Test: `scripts/test_clerk_auth.ts` (Suite 10: Calendar post modification ownership check) | Content moderation of post captions or media file validation at the API route layer. |
| **C11** | **Recommendation Preferences Isolation**: `GET` and `PUT` on `/api/recommendations/preferences` enforce strict tenant boundary based on verified `req.auth.userId`. Cross-tenant reads and writes return 403 Forbidden. | Commit: `c612d6d`<br>Test: `scripts/test_clerk_auth.ts` (Suite 10: Recommendation preferences tenant isolation) | JSON schema bounds checking on custom user weight values beyond primitive type checking. |
| **C12** | **Model Training Access Control**: `POST /api/models/train-personal/:handle` requires account ownership or admin privileges; `POST /api/models/train-global` requires admin privileges. | Commit: `c612d6d`<br>Test: `scripts/test_clerk_auth.ts` (Suite 10: Model training authorization) | CPU / memory resource exhaustion (Denial of Service) if authorized users trigger concurrent training jobs. |

---

## 2. Explicitly Excluded Claims

The following claims are **NOT** made and **MUST NOT** be inferred from this security step:

1. **"Secure against all attacks"**: Application-layer security controls cannot mitigate infrastructure misconfigurations, physical host access, compromised upstream npm dependencies, or zero-day kernel vulnerabilities.
2. **"Production-ready deployment"**: The Express API currently binds to port 5001 and relies on local filesystem storage (`storage/`) rather than an isolated PostgreSQL cluster with row-level security and automated backup replication.
3. **"Live Clerk JWKS Verified"**: Automated test suites operate against hermetic local RSA-256 PEM keys (`CLERK_JWT_KEY`). End-to-end network verification against live Clerk JWKS endpoints (`CLERK_SECRET_KEY`) has not been executed in CI.
4. **"Live Meta Graph API Verified"**: Meta Graph API integrations operate against mock providers and simulated payload structures. Live token exchange and OAuth token refreshes have not been executed against production Meta endpoints.
5. **"All Historic Secrets Revoked"**: Hardcoded secrets and legacy passwords identified in commit history are cataloged in `docs/AUTH.md` and marked "rotation pending operator confirmation". The automated test harness cannot rotate or invalidate credentials with external third-party providers.

---

## 3. Open Risks & Mitigation Status

### Risk 1: Pre-existing Duplicate Handles in Storage
- **Description**: Historical sessions in `storage/user_sessions/` created prior to Step 2.2 may contain duplicate account handles.
- **Current Status**: A non-destructive migration utility exists in `scripts/test_task2_uniqueness.ts` that safely detects duplicates without data loss. `POST /api/onboarding/user-profile` prevents new duplicates.
- **Operator Action Required**: An operator must review existing production session files and reconcile any historical duplicate accounts.

### Risk 2: Live Clerk Remote JWKS Latency & Network Dependency
- **Description**: In production configurations omitting `CLERK_JWT_KEY`, `@clerk/backend` resolves public keys dynamically over HTTPS from Clerk's remote JWKS endpoint.
- **Current Status**: Fails closed if keys are unreachable. Local tests pass with static RSA PEM key.
- **Operator Action Required**: Provide static `CLERK_JWT_KEY` in environment variables or ensure production network permits outbound HTTPS traffic to Clerk's API with appropriate timeouts and retries.

### Risk 3: Live Meta OAuth Credentials & Token Revocation
- **Description**: Real Meta Graph API tokens cannot be minted or refreshed without human-assisted Meta App review, live redirect URIs, and valid App Secret proofs.
- **Current Status**: Application operates fully offline in `DATA_MODE=seed` and `mock` modes.
- **Operator Action Required**: Complete Meta App configuration per Section 7 of the build plan when transitioning from development/evaluation to production.

### Risk 4: External Credential Rotation
- **Description**: Legacy commits contained Supabase service role keys and default admin passwords.
- **Current Status**: All items cataloged in `docs/AUTH.md` Section 5 with status `Compromised - Rotation pending operator confirmation`. Application code no longer uses hardcoded fallback credentials.
- **Operator Action Required**: Operator must log into the Supabase and hosting dashboards, invalidate compromised tokens, and inject fresh secrets via environment variables.
