import { JobWorker } from './lib/queue.js';

const worker = new JobWorker();

async function main() {
  process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down worker gracefully...');
    worker.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down worker gracefully...');
    worker.stop();
    process.exit(0);
  });

  await worker.start();
}

main().catch((err) => {
  console.error('Fatal error in worker process:', err);
  process.exit(1);
});
