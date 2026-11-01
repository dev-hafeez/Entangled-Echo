import fs from 'fs';
import path from 'path';

export class BrowserProfileLock {
  private lockFilePath: string;
  private isLocked: boolean = false;

  constructor(profileDir: string) {
    this.lockFilePath = path.resolve(profileDir, '..', '.chromium-profile.lock');
  }

  public acquire(): boolean {
    try {
      // Check if lock file already exists
      if (fs.existsSync(this.lockFilePath)) {
        const content = fs.readFileSync(this.lockFilePath, 'utf8');
        try {
          const info = JSON.parse(content);
          const ageMs = Date.now() - (info.timestamp || 0);
          // If lock is older than 10 minutes, treat as stale
          if (ageMs > 10 * 60 * 1000) {
            fs.unlinkSync(this.lockFilePath);
          } else {
            return false;
          }
        } catch {
          fs.unlinkSync(this.lockFilePath);
        }
      }

      // Write lock file atomically
      const payload = JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
      });
      fs.writeFileSync(this.lockFilePath, payload, { flag: 'wx' });
      this.isLocked = true;
      return true;
    } catch {
      return false;
    }
  }

  public release(): void {
    if (this.isLocked) {
      try {
        if (fs.existsSync(this.lockFilePath)) {
          fs.unlinkSync(this.lockFilePath);
        }
      } catch (err: any) {
        console.warn(`[lock] Could not delete lock file: ${err.message}`);
      }
      this.isLocked = false;
    }
  }
}
