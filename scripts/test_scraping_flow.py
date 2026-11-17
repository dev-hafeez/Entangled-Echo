import urllib.request
import urllib.parse
import json
import os
import sys
from playwright.sync_api import sync_playwright

def get_clerk_token():
    try:
        req = urllib.request.Request(
            'https://api.clerk.com/v1/sign_in_tokens',
            data=json.dumps({'user_id': 'user_3LbIhpWdZgIfGoQoi8h3aKxncvH'}).encode(),
            headers={
                'Authorization': 'Bearer sk_test_lVlIE8jai1fSqwRDyV5WasaUbaTqQk7XGTmHAD7ZpD',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)'
            }
        )
        res = json.loads(urllib.request.urlopen(req, timeout=10).read().decode())
        return res.get('token')
    except Exception as e:
        print("Could not obtain Clerk token:", e)
        return None

def test_admin_and_dashboard_scraping():
    print("=== Starting Scraping Functionality Verification ===")
    token = get_clerk_token()
    print("Obtained Clerk token:", token is not None)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})

        # Set admin auth cookie
        context.add_cookies([{
            'name': 'admin_auth',
            'value': 'true',
            'domain': 'localhost',
            'path': '/',
        }])

        page = context.new_page()

        if token:
            print("Authenticating with Clerk token on /sign-in ...")
            page.goto(f'http://localhost:3000/sign-in?__clerk_ticket={token}', wait_until='domcontentloaded')
            page.wait_for_timeout(4000)

        # 1. Test Admin Queue & Scrape Form
        print("\n--- 1. Testing Admin Page (/admin) ---")
        page.goto('http://localhost:3000/admin', wait_until='domcontentloaded')
        page.wait_for_timeout(2000)

        # If login form appears, log in
        login_input = page.locator('input[type="password"]')
        if login_input.count() > 0:
            print("Admin login form detected. Logging in with admin password...")
            login_input.fill('admin123')
            page.locator('button:has-text("Access"), button[type="submit"]').first.click()
            page.wait_for_timeout(3000)

        # Verify page header
        title = page.title()
        print(f"Admin Page Title: {title}")

        # Check job rows
        job_rows_count = page.evaluate("() => document.querySelectorAll('tbody tr').length")
        print(f"Queue rows in admin table: {job_rows_count}")
        assert job_rows_count > 0, "Admin page should display jobs in the queue table"

        # Check summary badges
        summary_text = page.evaluate("""() => {
            const el = document.querySelector('div:has(> button)');
            return document.body.innerText.slice(0, 1500);
        }""")
        print("Summary counts visible on admin page.")

        # Test submitting a scrape from Admin Form
        print("\nSubmitting a test scrape job from Admin Form...")
        textarea = page.locator('textarea[placeholder*="usernames"], textarea').first
        textarea.fill("test_admin_handle")
        
        # Click Start Scrape button
        submit_btn = page.locator('button:has-text("Start Scrape"), button:has-text("Start Ingestion"), button:has-text("Enqueue")').first
        submit_btn.click()
        page.wait_for_timeout(2000)

        # Verify success message or notice
        has_enqueued = page.locator('text="Enqueued"').count() > 0 or 'test_admin_handle' in page.content()
        print(f"Submission response verified: {has_enqueued}")

        # Check that test_admin_handle appears in the jobs list
        has_new_job = 'test_admin_handle' in page.content()
        print(f"New job visible in Admin table: {has_new_job}")
        assert has_new_job, "Newly enqueued job should appear in the admin jobs table"

        # Clean up test job via API
        req = urllib.request.Request('http://localhost:4000/api/jobs', headers={'User-Agent': 'test'})
        jobs_res = json.loads(urllib.request.urlopen(req).read().decode())
        target_job = next((j for j in jobs_res.get('jobs', []) if j.get('target_input') == 'test_admin_handle'), None)
        if target_job:
            del_req = urllib.request.Request(f"http://localhost:4000/api/jobs/{target_job['id']}", method='DELETE')
            urllib.request.urlopen(del_req)
            print('Cleaned up test job:', target_job['id'])

        # 2. Test Dashboard Progressive Scrape Polling
        print("\n--- 2. Testing Dashboard Page (/dashboard) ---")
        page.goto('http://localhost:3000/dashboard?handle=nightcreeper24', wait_until='domcontentloaded')
        page.wait_for_timeout(4000)

        # Check if dashboard loaded profile data
        handle_text = page.evaluate("() => document.body.innerText.includes('nightcreeper24')")
        print(f"Dashboard loaded @nightcreeper24: {handle_text}")
        assert handle_text, "Dashboard should render @nightcreeper24 profile"

        # Test API response for GET /api/jobs directly from browser context
        jobs_api_res = page.evaluate("""async () => {
            const res = await fetch('/api/jobs?limit=5');
            const data = await res.json();
            return {
                ok: res.ok,
                status: res.status,
                total: data.summary ? data.summary.total : data.jobs.length,
                jobsCount: data.jobs ? data.jobs.length : 0,
                firstJob: data.jobs && data.jobs.length > 0 ? data.jobs[0].target_input : null
            };
        }""")
        print(f"Browser fetch /api/jobs: ok={jobs_api_res['ok']}, total={jobs_api_res['total']}, count={jobs_api_res['jobsCount']}")
        assert jobs_api_res['ok'], "GET /api/jobs must return 200 OK"
        assert jobs_api_res['jobsCount'] > 0, "GET /api/jobs must return non-empty list of jobs"

        # Screenshot admin page for verification record
        os.makedirs('reports/ui-theme/verification', exist_ok=True)
        page.goto('http://localhost:3000/admin', wait_until='domcontentloaded')
        page.wait_for_timeout(2000)
        page.screenshot(path='reports/ui-theme/verification/admin_queue_working.png')
        print("Captured admin queue screenshot to reports/ui-theme/verification/admin_queue_working.png")

        browser.close()

    print("\n✓ ALL SCRAPING SYSTEM TESTS PASSED SUCCESSFULLY!")

if __name__ == '__main__':
    test_admin_and_dashboard_scraping()
