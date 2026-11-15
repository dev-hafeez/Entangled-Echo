import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('../apps/api/node_modules/playwright');

const screenshotDir = '/home/hafeez/.gemini/antigravity/brain/33828b00-e979-4122-833e-a0d72b3502ea';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  console.log('Navigating to http://localhost:3000/admin...');
  await page.goto('http://localhost:3000/admin', { waitUntil: 'networkidle' });

  // Check if login is needed
  const pwdInput = await page.$('input[type="password"]');
  if (pwdInput) {
    console.log('Logging in with admin password...');
    await pwdInput.fill('admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
  }

  console.log('Page loaded. Checking trigger scraper section...');
  const textarea = await page.waitForSelector('textarea', { timeout: 10000 });
  await textarea.fill('testbrand_xyz\nsport_hub_demo');

  console.log('Submitting scrape trigger...');
  const startBtn = await page.waitForSelector('button:has-text("Start Scrape")');
  await startBtn.click();

  console.log('Waiting for button response / success notification...');
  await page.waitForSelector('text=Enqueued 2 scrape job(s)!', { timeout: 10000 });
  console.log('SUCCESS: "Enqueued 2 scrape job(s)!" displayed!');

  // Wait 2 seconds for queue refresh
  await page.waitForTimeout(2000);

  const screenshotPath = `${screenshotDir}/trigger_test.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to ${screenshotPath}`);

  // Verify the jobs are in the jobs table
  const pageContent = await page.content();
  const hasJob1 = pageContent.includes('testbrand_xyz');
  const hasJob2 = pageContent.includes('sport_hub_demo');
  console.log(`Jobs visible in table - testbrand_xyz: ${hasJob1}, sport_hub_demo: ${hasJob2}`);

  await browser.close();
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
