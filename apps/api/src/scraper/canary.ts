import { InstagramScraper } from './instagram.js';

export interface CanaryPostExpectation {
  shortcode: string;
  expectedLikesMin: number;
  expectedCommentsMin: number;
  expectedTimestamp: string;
  expectedCaptionSnippet: string;
}

export const CANARY_POSTS: CanaryPostExpectation[] = [
  {
    shortcode: 'DU6Pcb4iDl0',
    expectedLikesMin: 1000,
    expectedCommentsMin: 50,
    expectedTimestamp: '2026-02-18T18:54:25.000Z',
    expectedCaptionSnippet: 'Original audio',
  },
  {
    shortcode: 'DN8lSJLEQGe',
    expectedLikesMin: 50000,
    expectedCommentsMin: 300,
    expectedTimestamp: '2025-08-29T17:04:26.000Z',
    expectedCaptionSnippet: 'Just another day in paradise',
  },
  {
    shortcode: 'DfFTTQ1NuBV',
    expectedLikesMin: 400,
    expectedCommentsMin: 20,
    expectedTimestamp: '2026-10-29T15:14:28.000Z',
    expectedCaptionSnippet: 'colossal',
  },
];

export async function runCanaryCheck(): Promise<{ passed: boolean; error?: string; results: any[] }> {
  const scraper = new InstagramScraper({ headless: true });
  const results: any[] = [];

  for (const canary of CANARY_POSTS) {
    try {
      const { result } = await scraper.scrape(`https://www.instagram.com/p/${canary.shortcode}/`, { maxPosts: 1 });
      const post = result.posts?.[0];

      if (!post) {
        return {
          passed: false,
          error: `Canary shortcode ${canary.shortcode} failed to return a post object.`,
          results,
        };
      }

      // Check required fields
      if (post.likesCount === null || post.likesCount === undefined) {
        return {
          passed: false,
          error: `Canary shortcode ${canary.shortcode} returned null likesCount.`,
          results,
        };
      }
      if (post.commentsCount === null || post.commentsCount === undefined) {
        return {
          passed: false,
          error: `Canary shortcode ${canary.shortcode} returned null commentsCount.`,
          results,
        };
      }
      if (!post.postedAt) {
        return {
          passed: false,
          error: `Canary shortcode ${canary.shortcode} returned null timestamp.`,
          results,
        };
      }
      if (!post.caption) {
        return {
          passed: false,
          error: `Canary shortcode ${canary.shortcode} returned null caption.`,
          results,
        };
      }

      results.push({
        shortcode: canary.shortcode,
        likes: post.likesCount,
        comments: post.commentsCount,
        timestamp: post.postedAt,
        caption: post.caption.slice(0, 50),
      });
    } catch (err: any) {
      return {
        passed: false,
        error: `Canary execution error on ${canary.shortcode}: ${err.message}`,
        results,
      };
    }
  }

  return { passed: true, results };
}
