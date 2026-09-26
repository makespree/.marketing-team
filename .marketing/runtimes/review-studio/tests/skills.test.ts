import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBundle } from '../server/skills.js';
const entry={path:'SKILL.md',content:'---\nname: sample\ndescription: Sample content instructions.\n---\n# Sample'};
test('skill packages reject traversal, duplicate files, code files and missing entry metadata',()=>{
  for(const path of ['../SKILL.md','/SKILL.md','a/../../x.md','a\\x.md','a//x.md','scripts/run.js'])assert.throws(()=>parseBundle({files:[entry,{path,content:'x'}]}));
  assert.throws(()=>parseBundle({files:[entry,entry]}));
  assert.throws(()=>parseBundle({files:[{...entry,content:'# No metadata'}]}));
  assert.throws(()=>parseBundle({files:[entry,{path:'large.md',content:'x'.repeat(512*1024+1)}]}));
});
test('skill packages preserve authored content and normalize order for reproducible hashes',()=>{
  const ref={path:'references/tone.md',content:'Hindi + English\nExact line breaks.\n'};
  const a=parseBundle({files:[ref,entry]}),b=parseBundle({files:[entry,ref]});
  assert.deepEqual(a,b);assert.equal(a.files.find(f=>f.path===ref.path)!.content,ref.content);
});
