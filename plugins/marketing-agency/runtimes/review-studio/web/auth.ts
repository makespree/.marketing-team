import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from 'firebase/app-check';
import config from '../project.json';
export const project = config;
export function runtimeEnvironment(): 'local' | 'cloud' {
  if (import.meta.env.MODE !== 'cloud' && ['127.0.0.1', 'localhost'].includes(location.hostname)) return 'local';
  if (import.meta.env.MODE === 'cloud' && config.cloud && (config.cloud as unknown as Cloud).allowedOrigins.includes(location.origin)) return 'cloud';
  throw new Error('This origin is not configured for this marketing workspace.');
}
type Cloud = { apiKey: string; authDomain: string; projectId: string; appId: string; appCheckSiteKey: string; allowedOrigins: string[] };
let client: ReturnType<typeof getAuth> | undefined;
let appCheck: ReturnType<typeof initializeAppCheck> | undefined;
export async function authClient() {
  if (!client) {
    const local = runtimeEnvironment() === 'local';
    const options = local ? { apiKey: 'demo-marketing-key', authDomain: `${config.local.projectId}.firebaseapp.com`, projectId: config.local.projectId } : config.cloud as unknown as Cloud;
    const app = initializeApp(options, `marketing-${config.workspaceId}`);
    client = getAuth(app);
    if (local) connectAuthEmulator(client, `http://127.0.0.1:${config.local.ports.auth}`, { disableWarnings: true });
    else appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider((config.cloud as unknown as Cloud).appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }
  await client.authStateReady(); return { auth: client };
}
export async function appCheckToken() { if (runtimeEnvironment() === 'local') return null; await authClient(); return (await getToken(appCheck!, false)).token; }
export async function signInGoogle() { if (runtimeEnvironment() !== 'cloud') throw new Error('Use local reviewer credentials.'); return signInWithPopup((await authClient()).auth, new GoogleAuthProvider()); }
