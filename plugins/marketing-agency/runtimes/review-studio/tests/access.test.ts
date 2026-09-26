import test from 'node:test';
import assert from 'node:assert/strict';
import { requireWorkspaceAccess, type Services } from '../server/services.js';
import { config } from '../server/config.js';

test('shared Google access requires verified Google sign-in; retains revocation and invite-only fallback', async () => {
  const old = process.env.MARKETING_ACCESS_MODE;
  let provider = 'google.com', verified = true, disabled = false, revoked = false;
  let claims: string[] = [];
  const services = { environment: 'cloud', auth: {
    verifyIdToken: async (_: string, checkRevoked: boolean) => {
      assert.equal(checkRevoked, true);
      if (revoked) throw Error('revoked');
      return { uid: 'test', email_verified: verified, firebase: { sign_in_provider: provider } };
    },
    getUser: async () => ({ disabled, customClaims: { marketingWorkspaces: claims } }),
  } } as unknown as Services;
  const call = () => requireWorkspaceAccess('Bearer test', services);
  try {
    process.env.MARKETING_ACCESS_MODE = 'google';
    assert.equal(await call(), 'test');
    await assert.rejects(requireWorkspaceAccess(undefined, services), { status: 401 });
    for (const other of ['password', 'anonymous', 'custom']) { provider = other; await assert.rejects(call(), { status: 403 }); }
    provider = 'google.com'; verified = false; await assert.rejects(call(), { status: 403 });
    verified = true; disabled = true; await assert.rejects(call(), { status: 403 });
    disabled = false; revoked = true; await assert.rejects(call(), { status: 401 }); revoked = false;
    delete process.env.MARKETING_ACCESS_MODE;
    await assert.rejects(call(), { status: 403 });
    claims = [config.workspaceId]; assert.equal(await call(), 'test');
    claims = ['another-workspace']; await assert.rejects(call(), { status: 403 });
    process.env.MARKETING_ACCESS_MODE = 'google'; services.environment = 'local';
    await assert.rejects(call(), { status: 403 });
  } finally { if (old === undefined) delete process.env.MARKETING_ACCESS_MODE; else process.env.MARKETING_ACCESS_MODE = old; }
});
