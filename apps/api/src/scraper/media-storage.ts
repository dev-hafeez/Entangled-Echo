import { getSupabaseAdmin } from '../lib/supabase.js';

/**
 * Downloads image buffer and uploads to Supabase Storage post-media bucket.
 * Path format: {handle}/{shortcode}/{index}.jpg
 * Skips failures and logs them, never crashes the scraper.
 */
export async function uploadPostMedia(
  handle: string,
  shortcode: string,
  index: number,
  buffer: Buffer,
  contentType: string = 'image/jpeg'
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const filePath = `${handle}/${shortcode}/${index}.jpg`;

  try {
    const { data, error } = await supabase.storage
      .from('post-media')
      .upload(filePath, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.warn(`[storage] Failed to upload ${filePath}: ${error.message}`);
      return null;
    }

    return filePath;
  } catch (err: any) {
    console.warn(`[storage] Error uploading ${filePath}: ${err.message}`);
    return null;
  }
}
