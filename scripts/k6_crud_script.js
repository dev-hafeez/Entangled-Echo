import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 100,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.API_BASE || 'http://localhost:4000';

export default function () {
  const userId = 'k6_user_' + __VU;
  
  // Create
  const createPayload = JSON.stringify({
    userId,
    accountHandle: 'cristiano',
    caption: 'k6 test post',
    hashtags: ['k6', 'loadtest'],
    mediaType: 'image',
    platform: 'instagram',
    scheduledTime: new Date(Date.now() + 3600000).toISOString(),
    status: 'SCHEDULED',
  });
  
  const createRes = http.post(`${BASE_URL}/api/calendar/posts`, createPayload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(createRes, { 'create post status 201': (r) => r.status === 201 });
  
  // Read
  const listRes = http.get(`${BASE_URL}/api/calendar/posts?userId=${userId}`);
  check(listRes, { 'list posts status 200': (r) => r.status === 200 });

  sleep(0.1);
}
