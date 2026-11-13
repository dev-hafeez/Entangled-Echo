import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.dirname(__dirname);

async function runSmtpSinkTest() {
  console.log('====================================================');
  console.log('🧪 FR-34: Email Transmission Test via Local SMTP Sink');
  console.log('====================================================');

  const PORT = 10255;
  let receivedEmail = '';
  let clientConnected = false;

  // 1. Create native SMTP Sink server
  const server = net.createServer((socket) => {
    clientConnected = true;
    socket.write('220 127.0.0.1 ESMTP Test Sink Ready\r\n');

    let inData = false;

    socket.on('data', (chunk) => {
      const str = chunk.toString();
      if (inData) {
        receivedEmail += str;
        if (str.includes('\r\n.\r\n') || str.endsWith('.\r\n') || str === '.\n') {
          inData = false;
          socket.write('250 2.0.0 OK: queued message\r\n');
        }
      } else {
        const line = str.trim();
        if (line.startsWith('HELO') || line.startsWith('EHLO')) {
          socket.write('250-127.0.0.1\r\n250 HELP\r\n');
        } else if (line.startsWith('MAIL FROM:')) {
          socket.write('250 2.1.0 Sender OK\r\n');
        } else if (line.startsWith('RCPT TO:')) {
          socket.write('250 2.1.5 Recipient OK\r\n');
        } else if (line.startsWith('DATA')) {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (line.startsWith('QUIT')) {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', () => resolve()));
  console.log(`[SMTP Sink] Listening on 127.0.0.1:${PORT}`);

  try {
    const { SmtpEmailProvider, setEmailProvider } = await import('../apps/api/dist/services/email.js');
    const { notificationStore } = await import('../apps/api/dist/services/notifications.js');

    const smtpProvider = new SmtpEmailProvider({
      host: '127.0.0.1',
      port: PORT,
      from: 'alerts@entangled-echo.com',
    });
    setEmailProvider(smtpProvider);

    console.log('[App] Triggering weekly digest to <creator@domain.test> for @cristiano...');
    const result = await notificationStore.triggerWeeklyDigest(
      'user_smtp_test',
      'cristiano',
      'creator@domain.test'
    );

    console.log(`[App] triggerWeeklyDigest result: success=${result.success}`);
    if (!result.success) throw new Error('triggerWeeklyDigest returned success=false');

    // Give socket small window to flush
    await new Promise((r) => setTimeout(r, 200));

    console.log(`\n[SMTP Sink] Email arrived: clientConnected=${clientConnected}, bytes=${receivedEmail.length}`);

    // Verify transmission headers & content
    if (!receivedEmail.includes('To: creator@domain.test')) {
      throw new Error('Email missing expected "To: creator@domain.test" header');
    }
    if (!receivedEmail.includes('Subject: Your Weekly Performance Digest for @cristiano')) {
      throw new Error('Email missing expected Subject header');
    }
    if (!receivedEmail.includes('From: alerts@entangled-echo.com')) {
      throw new Error('Email missing expected From header');
    }
    if (!receivedEmail.includes('Weekly Performance Digest') || !receivedEmail.includes('cristiano')) {
      throw new Error('Email body missing weekly digest content');
    }

    console.log('✅ Captured Email Headers & Preview:');
    const previewLines = receivedEmail.split('\r\n').slice(0, 15).join('\n');
    console.log(previewLines);

    console.log('\n====================================================');
    console.log('🎉 FR-34 Test PASSED: Email successfully delivered via live SMTP network socket.');
    console.log('====================================================');
  } finally {
    server.close();
  }
}

runSmtpSinkTest().catch((err) => {
  console.error('SMTP Sink Test FAILED:', err);
  process.exit(1);
});
