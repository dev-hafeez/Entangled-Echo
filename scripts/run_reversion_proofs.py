import subprocess
import os
import sys

FIXES = [
    {
        "id": "FIX 1.1",
        "name": "Admin Token Leakage Prevention",
        "commit": "52f1523",
        "file": "apps/web/src/app/api/auth/login/route.ts",
        "test_cmd": "./apps/api/node_modules/.bin/tsx scripts/test_proxy_security_after.ts",
        "test_name": "POST /api/auth/login returns 200 with { success: true } and no token in body",
        "revert_target": "const res = NextResponse.json({ success: true });",
        "revert_replacement": "const res = NextResponse.json({ success: true, token });",
    },
    {
        "id": "FIX 1.2",
        "name": "Proxy Allowlist Default Deny & Header Stripping",
        "commit": "52f1523",
        "file": "apps/web/src/app/api/proxy/[...path]/route.ts",
        "test_cmd": "./apps/api/node_modules/.bin/tsx scripts/test_proxy_security_after.ts",
        "test_name": "Arbitrary path blocked by default deny (403)",
        "revert_target": "} else if (!isAllowedUserPath(normalizedPath)) {",
        "revert_replacement": "} else if (false && !isAllowedUserPath(normalizedPath)) {",
    },
    {
        "id": "FIX 2.1",
        "name": "Onboarding Duplicate Handle Conflict Rejection",
        "commit": "742fa68",
        "file": "apps/api/src/routes/onboarding.ts",
        "test_cmd": "./apps/api/node_modules/.bin/tsx scripts/test_task2_uniqueness.ts",
        "test_name": "User user_alpha_1 attempting to claim \"NightCreeper24\" rejected with 409 Conflict",
        "revert_target": "if (existingBinding && existingBinding.userId !== userId) {",
        "revert_replacement": "if (false && existingBinding && existingBinding.userId !== userId) {",
    },
    {
        "id": "FIX 2.2",
        "name": "Handle Canonical Normalization (NFKC, Case, Whitespace, @)",
        "commit": "742fa68",
        "file": "apps/api/src/lib/auth.ts",
        "test_cmd": "./apps/api/node_modules/.bin/tsx scripts/test_task2_uniqueness.ts",
        "test_name": "normalizeHandle normalizes [Unicode NFKC fullwidth characters] \"ｎｉｇｈｔｃｒｅｅｐｅｒ２４\" -> \"nightcreeper24\"",
        "revert_target": """  return handle
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^@+/, '')
    .trim();""",
        "revert_replacement": "  return handle;",
    },
    {
        "id": "FIX 2.3",
        "name": "Audience Demographics Private Ownership Enforcement",
        "commit": "742fa68",
        "file": "apps/api/src/routes/accounts.ts",
        "test_cmd": "./apps/api/node_modules/.bin/tsx scripts/test_clerk_auth.ts --grep='audience'",
        "test_name": "Self-asserted onboarding handle without proof denies audience access (403)",
        "revert_target": "if (!isUserAccountOwnerOrAdmin(req, cleanHandle)) {",
        "revert_replacement": "if (false && !isUserAccountOwnerOrAdmin(req, cleanHandle)) {",
    },
    {
        "id": "FIX 3.1",
        "name": "Account Deletion Restricted to Administrator",
        "commit": "c612d6d",
        "file": "apps/api/src/routes/accounts.ts",
        "test_cmd": "./apps/api/node_modules/.bin/tsx scripts/test_clerk_auth.ts --grep='DELETE'",
        "test_name": "Non-admin DELETE /api/accounts/:handle rejected with 403 and files preserved",
        "revert_target": "accountsRouter.delete('/:idOrHandle', requireAdmin, async (req: Request, res: Response) => {",
        "revert_replacement": "accountsRouter.delete('/:idOrHandle', async (req: Request, res: Response) => {",
    },
    {
        "id": "FIX 3.2",
        "name": "Internal Tick Secret Fail-Closed on Unset Secret",
        "commit": "c612d6d",
        "file": "apps/api/src/index.ts",
        "test_cmd": "./apps/api/node_modules/.bin/tsx scripts/test_clerk_auth.ts --grep='fails closed'",
        "test_name": "POST /internal/tick fails closed (503) when INTERNAL_TICK_SECRET is unset",
        "revert_target": "const tickAuth = verifyTickSecret(req);",
        "revert_replacement": "if (!process.env.INTERNAL_TICK_SECRET) return res.json({ success: true, bypassed: true }); const tickAuth = verifyTickSecret(req);",
    },
    {
        "id": "FIX 3.3",
        "name": "Calendar Post Reassignment Privilege Escalation Defense",
        "commit": "c612d6d",
        "file": "apps/api/src/routes/calendar.ts",
        "test_cmd": "./apps/api/node_modules/.bin/tsx scripts/test_clerk_auth.ts --grep='reassign'",
        "test_name": "PATCH /api/calendar/posts/:id cannot reassign accountHandle to unowned account (403)",
        "revert_target": "if (!isUserAccountOwnerOrAdmin(req, cleanTarget)) {",
        "revert_replacement": "if (false && !isUserAccountOwnerOrAdmin(req, cleanTarget)) {",
    },
    {
        "id": "FIX 3.4",
        "name": "Recommendation Preferences Profile Ownership Enforcement",
        "commit": "c612d6d",
        "file": "apps/api/src/routes/recommendations.ts",
        "test_cmd": "./apps/api/node_modules/.bin/tsx scripts/test_clerk_auth.ts --grep='preferences'",
        "test_name": "GET /api/recommendations/preferences rejects unauthorized user (403)",
        "revert_target": "if (!isUserAccountOwnerOrAdmin(req, handle)) {",
        "revert_replacement": "if (false && !isUserAccountOwnerOrAdmin(req, handle)) {",
    },
    {
        "id": "FIX 3.5",
        "name": "Personal Model Training Execution Ownership Enforcement",
        "commit": "c612d6d",
        "file": "apps/api/src/routes/models.ts",
        "test_cmd": "./apps/api/node_modules/.bin/tsx scripts/test_clerk_auth.ts --grep='train-personal'",
        "test_name": "POST /api/models/train-personal/:handle rejects unauthorized user (403)",
        "revert_target": "if (!isUserAccountOwnerOrAdmin(req, cleanHandle)) {",
        "revert_replacement": "if (false && !isUserAccountOwnerOrAdmin(req, cleanHandle)) {",
    },
]

def run_bash(cmd):
    p = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()

def cleanup_sessions():
    for f in ["user_alpha_1.json", "user_beta_2.json", "user_gamma_3.json", "user_delta_4.json", "user_epsilon_5.json"]:
        p = os.path.join("storage", "user_sessions", f)
        if os.path.exists(p):
            os.remove(p)

results = []

for idx, item in enumerate(FIXES, 1):
    temp_branch = f"temp-revert-task1-{idx}"
    print(f"\n=================================================================")
    print(f"[{idx}/10] Testing {item['id']}: {item['name']}")
    print(f"Commit: {item['commit']} | Target: {item['file']}")
    print(f"=================================================================")

    # 1. Create temporary branch from fix commit
    cleanup_sessions()
    rc, out, err = run_bash(f"git checkout -b {temp_branch} {item['commit']}")
    if rc != 0:
        print(f"Error checking out {temp_branch}: {err}")
        sys.exit(1)

    # Bring in the latest test suites from security-step-2.2-clean
    run_bash(f"git checkout security-step-2.2-clean -- scripts/test_proxy_security_after.ts scripts/test_task2_uniqueness.ts scripts/test_clerk_auth.ts")

    # Read original file
    with open(item['file'], 'r') as fp:
        original_content = fp.read()

    if item['revert_target'] not in original_content:
        print(f"ERROR: revert_target not found in {item['file']}!")
        print(f"Looking for:\n{item['revert_target']}")
        run_bash("git restore .")
        run_bash("git checkout security-step-2.2-clean")
        run_bash(f"git branch -D {temp_branch}")
        sys.exit(1)

    # 2. Revert the fix in working tree
    reverted_content = original_content.replace(item['revert_target'], item['revert_replacement'], 1)
    with open(item['file'], 'w') as fp:
        fp.write(reverted_content)

    print(f"--> Running test with fix REVERTED: {item['test_name']}")
    rc_rev, out_rev, err_rev = run_bash(item['test_cmd'])
    combined_rev = out_rev + "\n" + err_rev

    # Extract relevant failing line
    fail_line = "FAILED"
    for line in combined_rev.splitlines():
        if "FAIL" in line or "MISMATCH" in line or "Error" in line:
            fail_line = line.strip()
            break
    print(f"    Exit Code: {rc_rev}")
    print(f"    Output (Reverted): {fail_line}")

    if rc_rev == 0:
        print(f"❌ BUG DETECTED: Test PASSED despite fix being reverted!")
        run_bash(f"git restore .")
        run_bash("git checkout security-step-2.2-clean")
        run_bash(f"git branch -D {temp_branch}")
        sys.exit(1)

    # 3. Restore the fix
    with open(item['file'], 'w') as fp:
        fp.write(original_content)

    print(f"--> Running test with fix RESTORED: {item['test_name']}")
    rc_rest, out_rest, err_rest = run_bash(item['test_cmd'])
    combined_rest = out_rest + "\n" + err_rest

    pass_line = "PASSED"
    for line in combined_rest.splitlines():
        if "PASS" in line and (item['test_name'][:20] in line or len(combined_rest.splitlines()) < 20):
            pass_line = line.strip()
            break
    print(f"    Exit Code: {rc_rest}")
    print(f"    Output (Restored): {pass_line}")

    if rc_rest != 0:
        print(f"❌ ERROR: Test failed when fix was restored!")
        print(combined_rest[-500:])
        run_bash(f"git restore .")
        run_bash("git checkout security-step-2.2-clean")
        run_bash(f"git branch -D {temp_branch}")
        sys.exit(1)

    # 4. Cleanup temporary branch
    cleanup_sessions()
    run_bash(f"git restore .")
    run_bash("git checkout security-step-2.2-clean")
    run_bash(f"git branch -D {temp_branch}")
    cleanup_sessions()

    results.append({
        "id": item["id"],
        "name": item["name"],
        "commit": item["commit"],
        "test_name": item["test_name"],
        "fail_output": fail_line,
        "pass_output": pass_line,
        "rc_rev": rc_rev,
        "rc_rest": rc_rest
    })

print("\n\n=================================================================")
print("                   FINAL REVERSION SUMMARY TABLE                  ")
print("=================================================================")
print(f"{'Fix ID':<9} | {'Commit':<8} | {'Test Name'}")
print("-" * 110)
for r in results:
    print(f"{r['id']:<9} | {r['commit']:<8} | {r['test_name']}")
    print(f"   [REVERTED] Exit Code: {r['rc_rev']:<2} -> {r['fail_output']}")
    print(f"   [RESTORED] Exit Code: {r['rc_rest']:<2} -> {r['pass_output']}")
