import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAppCheck } from 'firebase-admin/app-check';
import { config } from './config.js';
export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
export type Services = { app: App; auth: Auth; db: Firestore; bucket: string; environment: 'local' | 'cloud' };
export function servicesForRequest(): Services {
  const local = process.env.MARKETING_ENV === 'local';
  let projectId: string, bucket: string;
  if (local) {
    projectId = config.local.projectId;
    if (!projectId.startsWith('demo-') || process.env.GCLOUD_PROJECT !== projectId) throw new ApiError(503, 'environment-mismatch', 'Local project mismatch.');
    const expected = { FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${config.local.ports.auth}`, FIRESTORE_EMULATOR_HOST: `127.0.0.1:${config.local.ports.firestore}`, FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${config.local.ports.storage}` };
    for (const [name, value] of Object.entries(expected)) if (process.env[name] !== value) throw new ApiError(503, 'environment-mismatch', 'Local emulator configuration mismatch.');
    if (process.env.STORAGE_EMULATOR_HOST && process.env.STORAGE_EMULATOR_HOST !== `http://${expected.FIREBASE_STORAGE_EMULATOR_HOST}`) throw new ApiError(503, 'environment-mismatch', 'Storage emulator mismatch.');
    bucket = `${projectId}.appspot.com`;
  } else {
    const cloud = config.cloud;
    if (process.env.MARKETING_ENV !== 'cloud' || !cloud || process.env.GCLOUD_PROJECT !== cloud.projectId || process.env.MARKETING_REVIEW_ENABLED !== '1') throw new ApiError(503, 'cloud-disabled', 'Cloud review is not configured and enabled.');
    if (Object.keys(process.env).some(key => /(?:EMULATOR_HOST|STORAGE_EMULATOR_HOST)$/.test(key) && process.env[key])) throw new ApiError(503, 'environment-mismatch', 'Cloud cannot use emulator overrides.');
    projectId = cloud.projectId; bucket = cloud.storageBucket;
  }
  const name = `marketing-${local ? 'local' : 'cloud'}-${config.workspaceId}`;
  const app = getApps().find(a => a.name === name) ?? initializeApp({ projectId, storageBucket: bucket }, name);
  return { app, auth: getAuth(app), db: getFirestore(app, local ? '(default)' : config.cloud?.databaseId ?? '(default)'), bucket, environment: local ? 'local' : 'cloud' };
}
export async function requireWorkspaceAccess(value: string | undefined, services: Services): Promise<string> {
  const { auth } = services;
  const match = /^Bearer ([^\s]{1,8192})$/.exec(value ?? '');
  if (!match) throw new ApiError(401, 'unauthenticated', 'Sign in to use the review workspace.');
  let token;
  try { token = await auth.verifyIdToken(match[1]!, true); } catch { throw new ApiError(401, 'unauthenticated', 'Sign in again.'); }
  const user = await auth.getUser(token.uid);
  const invited = Array.isArray(user.customClaims?.marketingWorkspaces) && user.customClaims.marketingWorkspaces.includes(config.workspaceId);
  const googleAccess = services.environment === 'cloud' && process.env.MARKETING_ACCESS_MODE === 'google' && token.firebase?.sign_in_provider === 'google.com' && token.email_verified === true;
  if (user.disabled || (!invited && !googleAccess)) throw new ApiError(403, 'reviewer-required', 'This account does not have workspace access.');
  return token.uid;
}
export async function checkApp(token: string | undefined, services: Services) {
  if (services.environment === 'local') return;
  if (!token) throw new ApiError(401, 'app-check-required', 'App verification is required.');
  try { await getAppCheck(services.app).verifyToken(token); } catch { throw new ApiError(401, 'app-check-invalid', 'App verification failed.'); }
}
