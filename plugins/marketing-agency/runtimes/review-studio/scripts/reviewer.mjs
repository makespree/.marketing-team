import { readFile } from 'node:fs/promises';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
const config = JSON.parse(await readFile(new URL('../project.json', import.meta.url), 'utf8'));
if (process.env.MARKETING_ENV !== 'local' || process.env.GCLOUD_PROJECT !== config.local.projectId || !config.local.projectId.startsWith('demo-') || process.env.FIREBASE_AUTH_EMULATOR_HOST !== `127.0.0.1:${config.local.ports.auth}`) throw Error('Local demo configuration required.');
const auth = getAuth(initializeApp({ projectId: config.local.projectId }));
const email = 'reviewer@marketing.test', password = 'Local-review-only-2026!';
let user;
try { user = await auth.getUserByEmail(email); } catch (error) { if (error.code !== 'auth/user-not-found') throw error; user = await auth.createUser({ email, password }); }
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), marketingWorkspaces: [config.workspaceId] });
console.log(`Local-only login: ${email}\nLocal-only password: ${password}`);
