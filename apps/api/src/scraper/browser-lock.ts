import fs from 'fs';
import path from 'path';

export class BrowserProfileLock {
  private profileDir: string;
  private lockFilePath: string;
  private isLocked: boolean = false;
  private exitHandler?: () => void;

  constructor(profileDir: string) {
    this.profileDir = profileDir;
    this.lockFilePath = path.resolve(profileDir, '..', '.chromium-profile.lock');
  }

  /**
   * Tests whether the process that holds the lock is still alive.
   * Sending signal 0 does not terminate the process; it performs error checking only.
   */
  private isProcessAlive(pid: number): boolean {
    if (!pid || typeof pid !== 'number' || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      // ESRCH: No such process
      // EPERM: Process exists but we lack permission to send signals (still alive)
      return err.code === 'EPERM';
    }
  }

  /**
   * Attempts a single atomic lock acquisition.
   */
  private tryAcquireOnce(): boolean {
    try {
      if (fs.existsSync(this.lockFilePath)) {
        let isStale = false;
        try {
          const content = fs.readFileSync(this.lockFilePath, 'utf8');
          const info = JSON.parse(content);

          // If the lock was acquired by THIS exact process, re-use it
          if (info.pid === process.pid) {
            this.isLocked = true;
            return true;
          }

          // Check if the process holding the lock is still alive
          const isAlive = info.pid ? this.isProcessAlive(info.pid) : false;
          const ageMs = Date.now() - (info.timestamp || 0);

          // If holding process died OR lock is older than 5 minutes, it is stale
          if (!isAlive || ageMs > 5 * 60 * 1000) {
            console.log(
              `[lock] Evicting stale lock from PID ${info.pid} (alive=${isAlive}, age=${Math.round(
                ageMs / 1000
              )}s)`
            );
            isStale = true;
          }
        } catch {
          // Corrupted lock file
          isStale = true;
        }

        if (isStale) {
          try {
            fs.unlinkSync(this.lockFilePath);
          } catch {}
        } else {
          return false;
        }
      }

      // Write lock file atomically using wx flag
      const payload = JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
      });
      fs.writeFileSync(this.lockFilePath, payload, { flag: 'wx' });
      this.isLocked = true;

      // Clean up any residual Chromium singleton locks left from a previous process crash
      this.cleanResidualChromiumLocks();

      // Register exit hook to clean up on process exit
      this.registerExitHook();

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Acquires the browser profile lock, waiting up to timeoutMs if another worker is busy.
   */
  public async acquire(timeoutMs: number = 30000, pollIntervalMs: number = 1000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (this.tryAcquireOnce()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return this.tryAcquireOnce();
  }

  /**
   * Releases the lock file if owned by the current process.
   */
  public release(): void {
    if (this.isLocked) {
      try {
        if (fs.existsSync(this.lockFilePath)) {
          const content = fs.readFileSync(this.lockFilePath, 'utf8');
          try {
            const info = JSON.parse(content);
            if (info.pid === process.pid) {
              fs.unlinkSync(this.lockFilePath);
            }
          } catch {
            fs.unlinkSync(this.lockFilePath);
          }
        }
      } catch (err: any) {
        console.warn(`[lock] Could not delete lock file: ${err.message}`);
      }
      this.isLocked = false;
      this.unregisterExitHook();
    }
  }

  /**
   * Removes stale Chromium internal locks that may cause launchPersistentContext to hang or fail
   * if a prior process was terminated abruptly.
   */
  private cleanResidualChromiumLocks(): void {
    try {
      if (!fs.existsSync(this.profileDir)) return;
      const targets = [
        path.join(this.profileDir, 'SingletonLock'),
        path.join(this.profileDir, 'SingletonCookie'),
        path.join(this.profileDir, 'SingletonSocket'),
      ];
      for (const t of targets) {
        if (fs.existsSync(t)) {
          try {
            fs.unlinkSync(t);
          } catch {}
        }
      }
    } catch {}
  }

  private registerExitHook(): void {
    if (!this.exitHandler) {
      this.exitHandler = () => {
        try {
          if (fs.existsSync(this.lockFilePath)) {
            const content = fs.readFileSync(this.lockFilePath, 'utf8');
            const info = JSON.parse(content);
            if (info.pid === process.pid) {
              fs.unlinkSync(this.lockFilePath);
            }
          }
        } catch {}
      };
      process.on('exit', this.exitHandler);
    }
  }

  private unregisterExitHook(): void {
    if (this.exitHandler) {
      process.removeListener('exit', this.exitHandler);
      this.exitHandler = undefined;
    }
  }
}
