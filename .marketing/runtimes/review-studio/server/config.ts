import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// Both source (server/) and compiled output (lib/server/) resolve inside the kit.
const here = dirname(fileURLToPath(import.meta.url));
const root = here.endsWith('/lib/server') || here.endsWith('\\lib\\server') ? resolve(here, '../..') : resolve(here, '..');
export type Config = {
  workspaceId: string; name: string; socialHandle: string;
  languages: { code: string; label: string }[];
  local: { projectId: string; ports: { web: number; api: number; auth: number; firestore: number; storage: number; hub: number; logging: number; ui: number; websocket: number } };
  cloud: null | { projectId: string; databaseId?: string; storageBucket: string; authDomain: string; apiKey: string; appId: string; appCheckSiteKey: string; allowedOrigins: string[] };
};
export const config: Config = JSON.parse(readFileSync(resolve(root, 'project.json'), 'utf8'));
