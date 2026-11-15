import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

/**
 * Saves image buffer directly to local disk storage on PC:
 * Path format: storage/post-media/{handle}/{shortcode}/{index}.jpg
 * Relative path stored in DB: {handle}/{shortcode}/{index}.jpg
 * Skips failures and logs them, never crashes the scraper.
 */
export async function uploadPostMedia(
  handle: string,
  shortcode: string,
  index: number,
  buffer: Buffer,
  contentType: string = 'image/jpeg'
): Promise<string | null> {
  const relativePath = `${handle}/${shortcode}/${index}.jpg`;
  const absoluteDir = path.join(config.localStorageDir, 'post-media', handle, shortcode);
  const absoluteFilePath = path.join(absoluteDir, `${index}.jpg`);

  try {
    fs.mkdirSync(absoluteDir, { recursive: true });
    fs.writeFileSync(absoluteFilePath, buffer);
    return relativePath;
  } catch (err: any) {
    console.warn(`[local-storage] Error saving media file ${relativePath}: ${err.message}`);
    return null;
  }
}
