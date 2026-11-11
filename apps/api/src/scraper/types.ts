export type MetricSource = 'page_meta' | 'dom' | 'network_json' | null;
export type MetricPrecision = 'exact' | 'approximate_k' | 'approximate_m' | null;

export interface ParsedMetric {
  count: number | null;
  rawStr: string | null;
  precision: MetricPrecision;
  source: MetricSource;
}

export interface ScrapedComment {
  commentId: string | null;
  author: string | null;
  text: string | null;
  likesCount: number | null;
  postedAt: string | null; // ISO string
  authorSource: MetricSource;
  textSource: MetricSource;
  likesSource: MetricSource;
  postedAtSource: MetricSource;
}

export interface ScrapedPost {
  shortcode: string;
  url: string;
  mediaType: 'image' | 'video' | 'reel' | 'carousel' | null;
  mediaTypeSource: MetricSource;
  caption: string | null;
  captionSource: MetricSource;
  hashtags: string[];
  mentions: string[];
  postedAt: string | null; // ISO string - MUST BE NULL IF UNAVAILABLE, NEVER DEFAULT TO NOW!
  postedAtSource: MetricSource;
  likesCount: number | null; // NULL if hidden
  likesSource: MetricSource;
  likesRawStr: string | null;
  commentsCount: number | null; // NULL if unparsed
  commentsSource: MetricSource;
  commentsRawStr: string | null;
  viewsCount: number | null; // NULL if not reel or unavailable
  viewsSource: MetricSource;
  viewsRawStr: string | null;
  locationTag: string | null;
  locationTagSource: MetricSource;
  audioName: string | null;
  audioNameSource: MetricSource;
  mediaUrls: string[];
  storagePaths: string[];
  carouselSize: number | null;
  topComments: ScrapedComment[];
  scraper_version?: string;
  session_authenticated?: boolean;
}

export interface ScrapedProfile {
  handle: string;
  fullName: string | null;
  bio: string | null;
  externalLink: string | null;
  avatarUrl: string | null;
  isVerified: boolean | null;
  isBusiness: boolean | null;
  category: string | null;
  followers: ParsedMetric;
  following: ParsedMetric;
  postsCount: ParsedMetric;
}

export type FailureReason =
  | 'auth_missing'
  | 'auth_lost'
  | 'pagination_stalled'
  | 'login_wall'
  | 'private'
  | 'restricted'
  | 'not_found'
  | 'rate_limit'
  | 'network_error'
  | 'author_resolution_failed'
  | 'unknown';

export interface ScrapeResult {
  success: boolean;
  profile?: ScrapedProfile;
  posts?: ScrapedPost[];
  failureReason?: FailureReason;
  error?: string;
  postsFound: number;
  postsDetailed: number;
  postsFailed: number;
}
