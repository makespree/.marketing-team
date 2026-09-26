import fs from 'node:fs/promises';
import { cloudClient } from './cloud-client.mjs';
import { recordPublication } from './publication-record.mjs';
import { instagramReadback, facebookReadback } from './hermoso-readback.mjs';
try {
  const [planPath, receiptPath] = process.argv.slice(2);
  if (!planPath || !receiptPath) throw Error('Usage: node marketing/scripts/record-posted.mjs <prepared-plan.json> <publish-receipt.json>');
  const plan = JSON.parse(await fs.readFile(planPath,'utf8'));
  const receipt = JSON.parse(await fs.readFile(receiptPath,'utf8'));
  const facebook = receipt.args?.target === 'facebook';
  const account = facebook ? receipt.args.pageId : receipt.args?.account;
  if (!account || !receipt.args?.brand) throw Error('Receipt must include explicit account/Page and brand.');
  const readback = await (facebook ? facebookReadback : instagramReadback)(account, receipt.args.brand);
  console.log(JSON.stringify(await recordPublication(await cloudClient(), plan, receipt, readback),null,2));
} catch (error) { console.error(error.message); process.exitCode=1; }
