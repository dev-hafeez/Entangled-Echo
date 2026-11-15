import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { chromium } = require('../apps/api/node_modules/playwright');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(PROJECT_ROOT, '.chromium-profile');
const LOCK_FILE = path.resolve(PROJECT_ROOT, '.chromium-profile.lock');

async function main() {
  console.log('==================================================================');
  console.log('       📸 EntangledEcho: Instagram Browser Login Session          ');
  console.log('==================================================================');
  console.log(`Profile Directory: ${PROFILE_DIR}`);

  // 1. Clean up any stale file locks
  if (fs.existsSync(LOCK_FILE)) {
    try {
      fs.unlinkSync(LOCK_FILE);
      console.log('Removed old .chromium-profile.lock');
    } catch {}
  }
  const singletonLock = path.join(PROFILE_DIR, 'SingletonLock');
  if (fs.existsSync(singletonLock)) {
    try {
      fs.unlinkSync(singletonLock);
      console.log('Removed stale Chromium SingletonLock');
    } catch {}
  }

  // 2. Launch persistent Chromium in visible (headed) mode
  console.log('\nLaunching Chromium window...');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 850 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  console.log('Navigating to Instagram Login (https://www.instagram.com/accounts/login/)...');
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'load' });

  console.log('\n------------------------------------------------------------------');
  console.log('👉 ACTION REQUIRED:');
  console.log('1. A Chromium browser window has opened on your screen.');
  console.log('2. Log in manually with your Instagram credentials (username/password/2FA).');
  console.log('3. When prompted, select "Save Info" or dismiss notifications.');
  console.log('4. Once you see your Instagram Home feed, come back here.');
  console.log('   The script will automatically detect when you are logged in,');
  console.log('   or you can press [Enter] in this terminal when finished.');
  console.log('------------------------------------------------------------------\n');

  // Monitor cookies and URL for successful login
  let loggedIn = false;
  const checkInterval = setInterval(async () => {
    try {
      const url = page.url();
      const cookies = await context.cookies('https://www.instagram.com');
      const hasSession = cookies.some((c) => c.name === 'sessionid');
      const hasDsUserId = cookies.some((c) => c.name === 'ds_user_id');
      const isHome = !url.includes('/accounts/login') && !url.includes('/accounts/emailsignup') && !url.includes('/challenge');

      if (hasSession && hasDsUserId && isHome) {
        loggedIn = true;
        clearInterval(checkInterval);
        console.log('\n==================================================================');
        console.log('✅ Authentication SUCCESS: Both sessionid & ds_user_id verified!');
        console.log(`Cookies present: sessionid=true, ds_user_id=true`);
        console.log('Session cookies saved to .chromium-profile/');
        console.log('==================================================================');
        console.log('Closing browser in 3 seconds...');
        setTimeout(async () => {
          await context.close();
          console.log('✓ Done! The scraper will now use this authenticated session.');
          process.exit(0);
        }, 3000);
      }
    } catch {}
  }, 2000);

  // Also allow manual Enter key completion
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async () => {
    if (!loggedIn) {
      clearInterval(checkInterval);
      const cookies = await context.cookies('https://www.instagram.com').catch(() => []);
      const hasSession = cookies.some((c) => c.name === 'sessionid');
      const hasDsUserId = cookies.some((c) => c.name === 'ds_user_id');
      console.log('\nClosing browser and saving session...');
      console.log(`Status: sessionid=${hasSession}, ds_user_id=${hasDsUserId}`);
      await context.close();
      console.log('✓ Session profile updated.');
      process.exit(0);
    }
  });
}

main().catch((err) => {
  console.error('Login script error:', err);
  process.exit(1);
});
