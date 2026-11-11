import os
import glob
import json
import numpy as np
from datetime import datetime, timezone

def generate_datacard(dataset_name: str, base_dir: str, out_json: str) -> dict:
    p_dir = os.path.join(base_dir, 'posts')
    prof_dir = os.path.join(base_dir, 'profiles')
    
    post_files = sorted(glob.glob(os.path.join(p_dir, '*.json')))
    n_creators = len(post_files)
    
    posts_per_creator = []
    total_posts = 0
    real_timestamps = 0
    positive_likes_comments = 0
    author_matches_true = 0
    author_matches_checked = 0
    follower_precision = {}
    tier_counts = {'<100K': 0, '100K-1M': 0, '>1M': 0, 'unknown': 0}
    post_ages_days = []
    
    for pf in post_files:
        handle = os.path.basename(pf).replace('.json', '')
        prof_file = os.path.join(prof_dir, f'{handle}.json')
        followers = None
        prec = 'unknown'
        scraped_at = None
        
        if os.path.exists(prof_file):
            try:
                prof_data = json.load(open(prof_file, encoding='utf-8'))
                followers = prof_data.get('followers_count') or prof_data.get('followersCount')
                prec = prof_data.get('followers_precision') or 'unknown'
                scraped_at_str = prof_data.get('last_scraped_at') or prof_data.get('updated_at')
                if scraped_at_str:
                    scraped_at = datetime.fromisoformat(scraped_at_str.replace('Z', '+00:00'))
            except Exception:
                pass
        
        follower_precision[prec] = follower_precision.get(prec, 0) + 1
        if followers is None:
            tier_counts['unknown'] += 1
        elif followers < 100000:
            tier_counts['<100K'] += 1
        elif followers <= 1000000:
            tier_counts['100K-1M'] += 1
        else:
            tier_counts['>1M'] += 1
            
        try:
            posts = json.load(open(pf, encoding='utf-8'))
            p_len = len(posts)
            posts_per_creator.append(p_len)
            total_posts += p_len
            
            for p in posts:
                ts_str = p.get('postedAt') or p.get('posted_at')
                ts = None
                if ts_str:
                    try:
                        ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                        real_timestamps += 1
                        if scraped_at and ts:
                            age = (scraped_at - ts).total_seconds() / 86400.0
                            post_ages_days.append(age)
                    except Exception:
                        pass
                
                l = p.get('likesCount') if p.get('likesCount') is not None else p.get('likes_count')
                c = p.get('commentsCount') if p.get('commentsCount') is not None else p.get('comments_count')
                if l is not None and c is not None and l > 0 and c >= 0:
                    positive_likes_comments += 1
                    
                pam = p.get('post_author_matches')
                if pam is not None:
                    author_matches_checked += 1
                    if pam is True:
                        author_matches_true += 1
        except Exception:
            pass
            
    ppc = np.array(posts_per_creator) if posts_per_creator else np.array([0])
    ages = np.array(post_ages_days) if post_ages_days else np.array([0])
    
    card = {
        'dataset_name': dataset_name,
        'base_directory': base_dir,
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'n_creators': n_creators,
        'total_posts': total_posts,
        'posts_per_creator': {
            'min': int(np.min(ppc)),
            'median': float(np.median(ppc)),
            'p90': float(np.percentile(ppc, 90)),
            'max': int(np.max(ppc)),
            'creators_ge_5': int(np.sum(ppc >= 5)),
            'creators_ge_10': int(np.sum(ppc >= 10)),
            'creators_ge_20': int(np.sum(ppc >= 20))
        },
        'shares': {
            'real_publish_timestamps': {
                'count': real_timestamps,
                'total': total_posts,
                'fraction': float(real_timestamps / max(1, total_posts))
            },
            'positive_likes_comments': {
                'count': positive_likes_comments,
                'total': total_posts,
                'fraction': float(positive_likes_comments / max(1, total_posts))
            },
            'post_author_matches_true': {
                'count': author_matches_true,
                'checked': author_matches_checked,
                'fraction': float(author_matches_true / max(1, author_matches_checked)) if author_matches_checked > 0 else None,
                'note': 'Field post_author_matches was not instrumented by scraper during ingestion'
            }
        },
        'follower_precision_breakdown': follower_precision,
        'creators_by_tier': tier_counts,
        'post_age_at_scrape_days': {
            'min': float(np.min(ages)),
            'median': float(np.median(ages)),
            'p90': float(np.percentile(ages, 90)),
            'max': float(np.max(ages))
        } if len(post_ages_days) > 0 else None
    }
    
    os.makedirs(os.path.dirname(out_json), exist_ok=True)
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(card, f, indent=2)
    print(f'Wrote data card to {out_json}')
    return card

if __name__ == '__main__':
    generate_datacard('Snapshot 2026-11-03-clean-v2', 'storage/snapshots/2026-11-03-clean-v2', 'storage/data_card_clean_v2.json')
    generate_datacard('Live storage', 'storage', 'storage/data_card_live.json')
