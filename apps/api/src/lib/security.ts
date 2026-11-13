import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { Request, Response, NextFunction } from 'express';

/**
 * Strict Instagram/Facebook username validation regex (FR-07/Security)
 * Characters: alphanumeric, periods, underscores, 1 to 30 characters.
 * Rejects path traversals (../, %2e%2e, /, \\, absolute paths, null bytes).
 */
export const HANDLE_REGEX = /^[a-zA-Z0-9._]{1,30}$/;

export function sanitizeAndValidateHandle(rawHandle: unknown): string {
  if (typeof rawHandle !== 'string') {
    throw new Error('Invalid handle: must be a string');
  }
  const trimmed = rawHandle.trim().toLowerCase().replace(/^@/, '');

  // Disallow any traversal or reserved path characters
  if (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('..') ||
    trimmed.includes('%') ||
    trimmed.includes('\0')
  ) {
    throw new Error('Path traversal sequence detected in handle');
  }

  if (!HANDLE_REGEX.test(trimmed)) {
    throw new Error(`Invalid handle format: "${rawHandle}". Handle must be 1-30 chars matching /^[a-zA-Z0-9._]{1,30}$/`);
  }

  return trimmed;
}

/**
 * Lightweight sliding-window rate limiter for sensitive endpoints (scrape, AI, LLM)
 */
export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const requests = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
    const now = Date.now();
    const timestamps = requests.get(ip) || [];

    // Filter out timestamps outside current window
    const recent = timestamps.filter((t) => now - t < options.windowMs);

    if (recent.length >= options.maxRequests) {
      res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
      return res.status(429).json({
        error: options.message || 'Too many requests, please try again later.',
        retryAfterSeconds: Math.ceil(options.windowMs / 1000),
      });
    }

    recent.push(now);
    requests.set(ip, recent);
    next();
  };
}

/**
 * Magic bytes signature validator for image uploads
 */
const MAGIC_BYTES: Record<string, number[][]> = {
  jpeg: [
    [0xff, 0xd8, 0xff], // standard JPEG SOI
  ],
  png: [
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG signature
  ],
  webp: [
    [0x52, 0x49, 0x46, 0x46], // RIFF...WEBP
  ],
};

export function validateImageBuffer(
  buffer: Buffer,
  maxSizeBytes: number = 8 * 1024 * 1024 // 8 MB limit
): { valid: boolean; format?: string; error?: string } {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Empty file buffer' };
  }

  if (buffer.length > maxSizeBytes) {
    return {
      valid: false,
      error: `File size ${buffer.length} exceeds max allowed size of ${maxSizeBytes} bytes`,
    };
  }

  // Check magic bytes
  let detectedFormat: string | null = null;
  for (const [fmt, signatures] of Object.entries(MAGIC_BYTES)) {
    for (const sig of signatures) {
      if (buffer.length >= sig.length) {
        const matches = sig.every((byte, idx) => buffer[idx] === byte);
        if (matches) {
          detectedFormat = fmt;
          break;
        }
      }
    }
    if (detectedFormat) break;
  }

  if (!detectedFormat) {
    return {
      valid: false,
      error: 'Invalid file signature: magic bytes do not match JPEG, PNG, or WEBP',
    };
  }

  // Check for suspicious polyglot / script execution markers in the binary
  const binaryString = buffer.toString('binary', 0, Math.min(buffer.length, 1024));
  if (
    binaryString.includes('<?php') ||
    binaryString.includes('<script') ||
    binaryString.includes('<html')
  ) {
    return {
      valid: false,
      error: 'Dangerous polyglot / embedded script content detected in image header',
    };
  }

  return { valid: true, format: detectedFormat };
}

/**
 * Re-encodes uploaded image with Sharp, stripping metadata/EXIF/polyglots (SRDS D9)
 */
export async function sanitizeAndReencodeImage(buffer: Buffer): Promise<Buffer> {
  const validation = validateImageBuffer(buffer);
  if (!validation.valid) {
    throw new Error(`Upload security validation failed: ${validation.error}`);
  }

  // Strip all malicious payloads and re-encode to pure, sanitized JPEG
  return await sharp(buffer)
    .rotate()
    .toFormat('jpeg', { quality: 88, progressive: true })
    .toBuffer();
}
