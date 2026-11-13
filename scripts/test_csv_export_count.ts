import fs from 'fs';
import path from 'path';
import http from 'http';
import app from '../apps/api/src/index.js';

async function run() {
  console.log('================================================================');
  console.log('   FR-31: Historical Data CSV Export Row Count & Schema Test     ');
  console.log('================================================================\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const testHandles = ['cristiano', 'icc', 'virat.kohli', 'leomessi', 'abdulelsayed'];
  let passedCount = 0;

  try {
    for (const handle of testHandles) {
      console.log(`Testing CSV export for @${handle}...`);

      const postsPath = path.join(process.cwd(), 'storage', 'posts', `${handle}.json`);
      if (!fs.existsSync(postsPath)) {
        console.warn(`  Warning: storage/posts/${handle}.json not found, skipping.`);
        continue;
      }

      const storedPosts = JSON.parse(fs.readFileSync(postsPath, 'utf-8'));
      const expectedCount = Array.isArray(storedPosts) ? storedPosts.length : 0;

      const res = await fetch(`${baseUrl}/api/accounts/${handle}/export/csv`);
      if (!res.ok) {
        throw new Error(`Failed to export CSV for @${handle}: HTTP ${res.status} ${res.statusText}`);
      }

      const contentType = res.headers.get('content-type');
      const contentDisposition = res.headers.get('content-disposition');

      if (!contentType?.includes('text/csv')) {
        throw new Error(`Expected Content-Type text/csv, got "${contentType}"`);
      }
      if (!contentDisposition?.includes(`${handle}_metrics_export.csv`)) {
        throw new Error(`Expected Content-Disposition filename "${handle}_metrics_export.csv", got "${contentDisposition}"`);
      }

      const csvText = await res.text();

      // Robust CSV row parser that handles multiline quoted strings in captions
      const rows: string[] = [];
      let currentRow = '';
      let insideQuote = false;

      for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (char === '"') {
          if (insideQuote && nextChar === '"') {
            currentRow += '""';
            i++; // skip escaped quote
          } else {
            insideQuote = !insideQuote;
            currentRow += char;
          }
        } else if (char === '\n' && !insideQuote) {
          if (currentRow.trim().length > 0) {
            rows.push(currentRow);
          }
          currentRow = '';
        } else if (char === '\r') {
          // ignore carriage return
        } else {
          currentRow += char;
        }
      }
      if (currentRow.trim().length > 0) {
        rows.push(currentRow);
      }

      const header = rows[0];
      const dataRows = rows.slice(1);

      console.log(`  Expected Stored Posts Count : ${expectedCount}`);
      console.log(`  Exported CSV Data Row Count : ${dataRows.length}`);
      console.log(`  Header row                  : ${header.substring(0, 60)}...`);

      if (dataRows.length !== expectedCount) {
        throw new Error(
          `Row count mismatch for @${handle}! Stored JSON: ${expectedCount}, Exported CSV: ${dataRows.length}`
        );
      }

      // Check header integrity
      const expectedHeaderStart = 'shortcode,permalink,media_type,posted_at,likes_count,comments_count';
      if (!header.startsWith(expectedHeaderStart)) {
        throw new Error(`Invalid CSV header format: ${header}`);
      }

      console.log(`  [PASS] @${handle} CSV matches exactly ${expectedCount} stored posts.\n`);
      passedCount++;
    }

    console.log('================================================================');
    console.log(`   FR-31 VERIFICATION COMPLETE: ALL ${passedCount} ACCOUNTS MATCHED CSV ROWS `);
    console.log('================================================================');
    process.exit(0);
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('FR-31 test failed:', err);
  process.exit(1);
});
