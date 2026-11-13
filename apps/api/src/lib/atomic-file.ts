import fs from 'fs';
import path from 'path';

/**
 * In-memory mutex map keyed by resolved file path to prevent lost updates
 * during concurrent async write operations in Node.js.
 */
const lockMap = new Map<string, Promise<void>>();

export async function withFileLock<T>(filePath: string, fn: () => Promise<T> | T): Promise<T> {
  const resolved = path.resolve(filePath);
  const currentLock = lockMap.get(resolved) || Promise.resolve();

  let releaseLock: () => void = () => {};
  const nextLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  // Chain lock
  lockMap.set(resolved, currentLock.then(() => nextLock));

  await currentLock;
  try {
    return await fn();
  } finally {
    releaseLock();
    if (lockMap.get(resolved) === nextLock) {
      lockMap.delete(resolved);
    }
  }
}

/**
 * Atomically writes data to a file by writing to a unique temporary file
 * and performing an atomic filesystem rename (POSIX atomic rename).
 */
export function writeJsonAtomic(filePath: string, data: any): void {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${resolved}.${process.pid}.${Date.now()}.${Math.random().toString(36).substring(2)}.tmp`;
  const serialized = JSON.stringify(data, null, 2);

  fs.writeFileSync(tmpPath, serialized, 'utf-8');
  fs.renameSync(tmpPath, resolved);
}

/**
 * Safely reads JSON from a file, returning fallback if missing or corrupt.
 */
export function readJsonSafe<T = any>(filePath: string, fallback: T): T {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return fallback;
  try {
    const raw = fs.readFileSync(resolved, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}
