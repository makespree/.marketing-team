import { onRequest, type Request } from 'firebase-functions/v2/https';
import { contentReview } from './content-review.js';
import { analyticsApi } from './analytics.js';
import { skillsApi } from './skills.js';
import { ApiError, checkApp, servicesForRequest } from './services.js';
type Response = Parameters<Parameters<typeof onRequest>[0]>[1];
export async function handler(request: Request, response: Response) {
  response.set('Cache-Control', 'no-store');
  try {
    const services = servicesForRequest();
    await checkApp(request.get('X-Firebase-AppCheck'), services);
    const path = request.path.replace(/^\/api(?=\/)/, '');
    if (!path.startsWith('/marketing/')) throw new ApiError(404, 'not-found', 'Not found.');
    if (path === '/marketing/analytics' || path.startsWith('/marketing/analytics/')) await analyticsApi(request, response, services, path);
    else if (path === '/marketing/skills' || path.startsWith('/marketing/skills/')) await skillsApi(request, response, services, path);
    else await contentReview(request, response, services, path);
  } catch (error) {
    const known = error instanceof ApiError;
    response.status(known ? error.status : 500).json({ error: { code: known ? error.code : 'internal-error', message: known ? error.message : 'The request could not be completed.' } });
  }
}
export const marketingApi = onRequest({ region: 'asia-south1', minInstances: 0, maxInstances: 3, memory: '256MiB', timeoutSeconds: 60 }, handler);
