import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('../apps/api/node_modules/playwright');

const screenshotDir = '/home/hafeez/.gemini/antigravity/brain/33828b00-e979-4122-833e-a0d72b3502ea';
fs.mkdirSync(screenshotDir, { recursive: true });

async function run() {
  console.log('Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('response', (res) => {
    if (res.url().includes('/api/')) {
      console.log(`API [${res.status()}] ${res.url()}`);
    }
  });

  console.log('Navigating to http://localhost:3000/admin ...');
  await page.goto('http://localhost:3000/admin', { waitUntil: 'networkidle' });

  // Check if password prompt is visible
  const passInput = await page.$('input[type="password"]');
  if (passInput) {
    console.log('Logging in with admin password...');
    await passInput.fill('admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
  }

  console.log('Waiting for admin page data to load...');
  await page.waitForTimeout(3000);

  // Take screenshot of admin page
  const adminScreenshot = path.join(screenshotDir, 'admin_page.png');
  await page.screenshot({ path: adminScreenshot, fullPage: true });
  console.log('Saved admin page screenshot to:', adminScreenshot);

  // Extract account handles rendered in DOM
  const accountRows = await page.$$eval('table tbody tr', (rows) =>
    rows.map((r) => r.innerText.replace(/\n+/g, ' | ').trim()).filter((t) => t.length > 0)
  );
  console.log(`Rendered table rows count: ${accountRows.length}`);
  console.log('First 5 rows rendered:\n', accountRows.slice(0, 5).join('\n'));

  // Extract options in the select dropdown
  const selectOptions = await page.$$eval('select option', (opts) =>
    opts.map((o) => o.innerText.trim()).filter((t) => t.length > 0)
  );
  console.log(`Select dropdown options count: ${selectOptions.length}`);
  console.log('Select dropdown options sample:\n', selectOptions.slice(0, 8).join('\n'));

  // Test account details page
  console.log('Navigating to http://localhost:3000/admin/accounts/icc ...');
  await page.goto('http://localhost:3000/admin/accounts/icc', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const accountScreenshot = path.join(screenshotDir, 'account_icc_page.png');
  await page.screenshot({ path: accountScreenshot, fullPage: true });
  console.log('Saved account page screenshot to:', accountScreenshot);

  // Check posts rendered on account page
  const postsCount = await page.$$eval('img', (imgs) => imgs.length);
  console.log(`Images/thumbnails found on icc account page: ${postsCount}`);

  await browser.close();
  console.log('Chromium verification completed successfully!');
}

run().catch((err) => {
  console.error('Chromium run error:', err);
  process.exit(1);
});
