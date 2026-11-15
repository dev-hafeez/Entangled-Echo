import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('../apps/api/node_modules/playwright');

const screenshotDir = '/home/hafeez/.gemini/antigravity/brain/33828b00-e979-4122-833e-a0d72b3502ea';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:3000/admin...');
  await page.goto('http://localhost:3000/admin', { waitUntil: 'networkidle' });

  const pwdInput = await page.$('input[type="password"]');
  if (pwdInput) {
    console.log('Logging in with admin password...');
    await pwdInput.fill('admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }

  console.log('Taking full page screenshot...');
  const screenshotPath = `${screenshotDir}/admin_page_final.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Saved screenshot to ${screenshotPath}`);

  // Check content
  const content = await page.content();
  console.log('Contains leomessi:', content.includes('leomessi'));
  console.log('Contains model version:', content.includes('v_personal_20261102_092600'));

  // Also navigate to /admin/accounts/leomessi
  console.log('Navigating to http://localhost:3000/admin/accounts/leomessi...');
  await page.goto('http://localhost:3000/admin/accounts/leomessi', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const leomessiScreenshot = `${screenshotDir}/account_leomessi_page.png`;
  await page.screenshot({ path: leomessiScreenshot, fullPage: true });
  console.log(`Saved leomessi screenshot to ${leomessiScreenshot}`);

  await browser.close();
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
