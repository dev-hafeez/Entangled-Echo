import urllib.request
import urllib.parse
import json
import os
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

def test_dashboard():
    os.makedirs('reports/ui-theme/verification', exist_ok=True)
    token = get_clerk_token()
    print("Obtained Clerk token:", token is not None)

    summary = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = context.new_page()

        if token:
            print("Authenticating with __clerk_ticket on /sign-in ...")
            page.goto(f'http://localhost:3000/sign-in?__clerk_ticket={token}', wait_until='domcontentloaded')
            page.wait_for_timeout(4000)

        test_handles = ['nightcreeper24', 'kaleem._.abbasi830']

        for handle in test_handles:
            print(f"\n================ Testing @{handle} ================")
            target_url = f'http://localhost:3000/dashboard?handle={handle}'
            page.goto(target_url, wait_until='domcontentloaded')
            page.wait_for_timeout(4000)

            # Check Profile Avatar
            avatar_info = page.evaluate("""() => {
                const img = document.querySelector('img[src*="/api/media/avatar"]');
                if (!img) return { found: false };
                return {
                    found: true,
                    src: img.src,
                    alt: img.alt,
                    naturalWidth: img.naturalWidth,
                    naturalHeight: img.naturalHeight,
                    complete: img.complete
                };
            }""")

            # Check Post Cards & Images
            posts_info = page.evaluate("""() => {
                const cards = Array.from(document.querySelectorAll('.grid > div.group'));
                return cards.map(c => {
                    const img = c.querySelector('img');
                    const scoreMatch = c.innerText.match(/Score:\\s*(\\d+)|(\\d+)\\/100/);
                    const whySection = c.innerText.includes('Why this score');
                    const improvementsSection = c.innerText.includes('Improvements needed');

                    return {
                        hasImg: !!img,
                        imgSrc: img ? img.src : null,
                        imgLoaded: img ? (img.complete && img.naturalWidth > 0) : false,
                        imgNaturalWidth: img ? img.naturalWidth : 0,
                        score: scoreMatch ? (scoreMatch[1] || scoreMatch[2]) : null,
                        hasWhy: whySection,
                        hasImprovements: improvementsSection,
                        textSnippet: c.innerText.slice(0, 150)
                    };
                });
            }""")

            loaded_imgs = sum(1 for post in posts_info if post['imgLoaded'])
            posts_with_score = sum(1 for post in posts_info if post['score'] is not None)
            posts_with_why = sum(1 for post in posts_info if post['hasWhy'])
            posts_with_improvements = sum(1 for post in posts_info if post['hasImprovements'])

            print(f"Profile Avatar for @{handle}: found={avatar_info.get('found')}, size={avatar_info.get('naturalWidth')}x{avatar_info.get('naturalHeight')}")
            print(f"Total post cards detected: {len(posts_info)}")
            print(f"Post Cards with Loaded Images: {loaded_imgs}/{len(posts_info)}")
            print(f"Post Cards with Score: {posts_with_score}/{len(posts_info)}")
            print(f"Post Cards with 'Why this score': {posts_with_why}/{len(posts_info)}")
            print(f"Post Cards with 'Improvements needed': {posts_with_improvements}/{len(posts_info)}")

            screenshot_path = f'reports/ui-theme/verification/{handle}.png'
            page.screenshot(path=screenshot_path, full_page=False)
            print(f"Saved screenshot: {screenshot_path}")

            summary[handle] = {
                'avatar': avatar_info,
                'total_posts': len(posts_info),
                'loaded_images': loaded_imgs,
                'posts_with_score': posts_with_score,
                'posts_with_why': posts_with_why,
                'posts_with_improvements': posts_with_improvements,
                'sample_post': posts_info[0] if len(posts_info) > 0 else None
            }

        browser.close()

    with open('reports/ui-theme/verification/verification_summary.json', 'w') as f:
        json.dump(summary, f, indent=2)
    print("\nWrote summary to reports/ui-theme/verification/verification_summary.json")

if __name__ == '__main__':
    test_dashboard()
