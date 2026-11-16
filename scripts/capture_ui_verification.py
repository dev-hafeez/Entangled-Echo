import os
import time
import json
from playwright.sync_api import sync_playwright

def run():
    os.makedirs('reports/ui/screenshots', exist_ok=True)
    results = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-setuid-sandbox'])

        # -------------------------------------------------------------
        # 1. LANDING PAGE (Signed Out) - 1440px & 390px
        # -------------------------------------------------------------
        print("Testing Landing Page (1440px)...")
        context_1440 = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = context_1440.new_page()
        page.goto('http://localhost:3000/', wait_until='domcontentloaded')
        page.wait_for_selector('text=EntangledEcho', timeout=10000)
        time.sleep(0.5)
        page.screenshot(path='reports/ui/screenshots/landing_1440.png', full_page=True)

        # Hover state test on landing button
        btn = page.locator('a[href="/sign-up"] button').first
        btn.wait_for(state='visible')
        btn_before = btn.evaluate("""el => {
            const cs = window.getComputedStyle(el);
            return {
                backgroundColor: cs.backgroundColor,
                color: cs.color,
                borderTopColor: cs.borderTopColor,
                borderTopWidth: cs.borderTopWidth
            };
        }""")
        btn.hover()
        time.sleep(0.3)
        btn_after = btn.evaluate("""el => {
            const cs = window.getComputedStyle(el);
            return {
                backgroundColor: cs.backgroundColor,
                color: cs.color,
                borderTopColor: cs.borderTopColor,
                borderTopWidth: cs.borderTopWidth
            };
        }""")
        results['button_hover'] = {
            'before': btn_before,
            'after': btn_after
        }

        # Hover state test on landing card
        card = page.locator('.grid > div').first
        card.wait_for(state='visible')
        card_before = card.evaluate("""el => {
            const cs = window.getComputedStyle(el);
            return {
                transform: cs.transform,
                boxShadow: cs.boxShadow
            };
        }""")
        card.hover()
        time.sleep(0.3)
        card_after = card.evaluate("""el => {
            const cs = window.getComputedStyle(el);
            return {
                transform: cs.transform,
                boxShadow: cs.boxShadow
            };
        }""")
        results['card_hover'] = {
            'before': card_before,
            'after': card_after
        }
        context_1440.close()

        print("Testing Landing Page (390px)...")
        context_390 = browser.new_context(viewport={'width': 390, 'height': 844})
        page = context_390.new_page()
        page.goto('http://localhost:3000/', wait_until='domcontentloaded')
        page.wait_for_selector('text=EntangledEcho', timeout=10000)
        time.sleep(0.5)
        page.screenshot(path='reports/ui/screenshots/landing_390.png', full_page=True)

        landing_scroll = page.evaluate("""() => ({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth
        })""")
        results['landing_scroll_390'] = landing_scroll
        context_390.close()

        # -------------------------------------------------------------
        # 2. DASHBOARD (Signed In with @cristiano) - 1440px & 390px
        # -------------------------------------------------------------
        print("Testing Dashboard with images (@cristiano) (1440px)...")
        context_dash_1440 = browser.new_context(viewport={'width': 1440, 'height': 900})
        context_dash_1440.add_cookies([{'name': '__test_session', 'value': 'true', 'domain': 'localhost', 'path': '/'}])
        page = context_dash_1440.new_page()
        page.goto('http://localhost:3000/dashboard?handle=cristiano', wait_until='domcontentloaded')
        page.wait_for_selector('text=Your Recent Posts', timeout=15000)
        time.sleep(1.0)
        page.screenshot(path='reports/ui/screenshots/dashboard_1440.png', full_page=True)
        context_dash_1440.close()

        print("Testing Dashboard with images (@cristiano) (390px)...")
        context_dash_390 = browser.new_context(viewport={'width': 390, 'height': 844})
        context_dash_390.add_cookies([{'name': '__test_session', 'value': 'true', 'domain': 'localhost', 'path': '/'}])
        page = context_dash_390.new_page()
        page.goto('http://localhost:3000/dashboard?handle=cristiano', wait_until='domcontentloaded')
        page.wait_for_selector('text=Your Recent Posts', timeout=15000)
        time.sleep(1.0)
        page.screenshot(path='reports/ui/screenshots/dashboard_390.png', full_page=True)

        dash_scroll = page.evaluate("""() => ({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth
        })""")
        results['dashboard_scroll_390'] = dash_scroll
        context_dash_390.close()

        # -------------------------------------------------------------
        # 3. DASHBOARD WITH NO IMAGE POSTS (@rondarousey) - 1440px & 390px
        # -------------------------------------------------------------
        print("Testing Dashboard without post images (@rondarousey) (1440px)...")
        context_no_img_1440 = browser.new_context(viewport={'width': 1440, 'height': 900})
        context_no_img_1440.add_cookies([{'name': '__test_session', 'value': 'true', 'domain': 'localhost', 'path': '/'}])
        page = context_no_img_1440.new_page()
        page.goto('http://localhost:3000/dashboard?handle=rondarousey', wait_until='domcontentloaded')
        page.wait_for_selector('text=Image unavailable', timeout=15000)
        time.sleep(1.0)
        page.screenshot(path='reports/ui/screenshots/dashboard_no_image_1440.png', full_page=True)
        context_no_img_1440.close()

        print("Testing Dashboard without post images (@rondarousey) (390px)...")
        context_no_img_390 = browser.new_context(viewport={'width': 390, 'height': 844})
        context_no_img_390.add_cookies([{'name': '__test_session', 'value': 'true', 'domain': 'localhost', 'path': '/'}])
        page = context_no_img_390.new_page()
        page.goto('http://localhost:3000/dashboard?handle=rondarousey', wait_until='domcontentloaded')
        page.wait_for_selector('text=Image unavailable', timeout=15000)
        time.sleep(1.0)
        page.screenshot(path='reports/ui/screenshots/dashboard_no_image_390.png', full_page=True)

        no_img_scroll = page.evaluate("""() => ({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth
        })""")
        results['no_image_scroll_390'] = no_img_scroll
        context_no_img_390.close()

        browser.close()

    print("\nVerification Results:")
    print(json.dumps(results, indent=2))
    with open('reports/ui/test_metrics.json', 'w') as f:
        json.dump(results, f, indent=2)
    return results

if __name__ == '__main__':
    run()
