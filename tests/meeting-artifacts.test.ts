import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { Meeting } from '../src/shared/protocol.js';
import type { Floor } from '../src/server/floor.js';
import { DEFAULT_WORKFLOW } from '../src/shared/meeting-workflows.js';
import { archiveCustomArtifacts, archivedResult, artifactHash, stageMeetingInputs, verifyArchivedReview, INPUT_LIMIT } from '../src/server/meeting-patterns/artifacts.js';
import { findRoutedMeeting, meetingArtifacts } from '../src/server/task-routing/results.js';

function fixture(t: test.TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'meeting-artifacts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'producer'), next = path.join(root, 'consumer');
  mkdirSync(cwd); mkdirSync(next);
  const workflow = structuredClone(DEFAULT_WORKFLOW);
  workflow.result.rules.push({path:'document.text',type:'string'});
  workflow.result.attachments=[{path:'document.path',content:'document.text',sha256:'document.digest',maxBytes:200000}];
  const body='Reviewed material\n';writeFileSync(path.join(cwd,'document.txt'),body);
  const raw=JSON.stringify({summary:'Review — complete',document:{path:'document.txt',digest:artifactHash(body)}},null,2)+'\n';
  const report='# Reviewed document\n';
  writeFileSync(path.join(cwd,'result.json'),raw);writeFileSync(path.join(cwd,'result.json.md'),report);
  const m={id:'prior-a',pattern:'custom',workflow,output:'result.json',status:'done'} as Meeting;
  const archive=path.join(root,'.agent-office','meetings',m.id);mkdirSync(archive,{recursive:true});
  cpSync(path.join(cwd,m.output),path.join(archive,'output-result.json'));
  archiveCustomArtifacts(cwd,archive,m);
  writeFileSync(path.join(archive,'knowledge-review.json'),JSON.stringify({output:artifactHash(JSON.stringify([raw,report])),changed:[]}));
  const floor={def:{dir:root},meetings:{state:()=>({spaces:[{id:'main',current:null,past:[{id:m.id,status:'done',output:m.output,routingKey:'key-a'}]}]})}} as unknown as Floor;
  return {root,cwd,next,archive,m,floor,raw,report,body};
}

test('reviewed originals survive attachment expansion, clearing and worktree removal',t=>{
  const f=fixture(t);rmSync(f.cwd,{recursive:true});
  assert.equal(readFileSync(path.join(f.archive,'output-result.json'),'utf8'),f.raw);
  assert.equal(verifyArchivedReview(f.archive,path.join(f.archive,'output-result.json')),undefined);
  const result=findRoutedMeeting(f.floor,'key-a')!;
  assert.equal(result.state,'done');assert.equal(result.error,undefined);
  assert.equal((result.result!.document as any).text,f.body);
  const bundle=meetingArtifacts(f.floor,['prior-a']);stageMeetingInputs(f.next,bundle.files);
  assert.equal(bundle.references.length,1);
  const ref=bundle.references[0];
  assert.equal(readFileSync(path.join(f.next,ref.output_path),'utf8'),f.raw);
  assert.equal(readFileSync(path.join(f.next,ref.report_path),'utf8'),f.report);
  assert.equal(artifactHash(readFileSync(path.join(f.next,ref.output_path),'utf8')),ref.output_sha256);
  assert.equal(JSON.parse(readFileSync(path.join(f.next,ref.resolved_output_path!),'utf8')).document.text,f.body);
  assert.ok(!JSON.stringify(bundle.references).includes(f.root));
});

test('tampering with reviewed bytes, report or derived decisions fails closed',t=>{
  const f=fixture(t),original=path.join(f.archive,'output-result.json');
  writeFileSync(original,f.raw+' ');
  assert.throws(()=>meetingArtifacts(f.floor,['prior-a']),/review digest/);
  writeFileSync(original,f.raw);
  const derived=path.join(f.archive,'resolved-output-result.json');const d=JSON.parse(readFileSync(derived,'utf8'));
  d.summary='Altered decision';writeFileSync(derived,JSON.stringify(d));
  assert.throws(()=>archivedResult(f.archive,original,f.m.workflow!),/differs from reviewed/);
  assert.match(findRoutedMeeting(f.floor,'key-a')!.error!,/differs from reviewed/);
});

test('missing predecessors and external symlink sources cannot silently lose context',t=>{
  const f=fixture(t);
  assert.throws(()=>meetingArtifacts(f.floor,['missing']),/unavailable/);
  assert.throws(()=>meetingArtifacts(f.floor,['../outside']),/identity/);
  const report=path.join(f.archive,'output-result.json.md');rmSync(report);
  symlinkSync('/etc/hosts',report);
  assert.throws(()=>meetingArtifacts(f.floor,['prior-a']),/outside floor/);
});

test('staging refuses traversal, altered bytes, duplicate files, symlink parents and oversize bundles',t=>{
  const f=fixture(t),bundle=meetingArtifacts(f.floor,['prior-a']);
  assert.throws(()=>stageMeetingInputs(f.next,[{...bundle.files[0],path:'../outside.json'}]),/Invalid/);
  assert.throws(()=>stageMeetingInputs(f.next,[{...bundle.files[0],sha256:'wrong'}]),/Invalid/);
  const other=path.join(f.root,'another');mkdirSync(other);symlinkSync(other,path.join(f.next,'.meeting'));
  assert.throws(()=>stageMeetingInputs(f.next,bundle.files),/symlink/);
  rmSync(path.join(f.next,'.meeting'));
  assert.equal(existsSync(path.join(other,'inputs')),false);
  assert.throws(()=>stageMeetingInputs(f.next,[...bundle.files,...bundle.files]),/duplicate/);
  assert.throws(()=>stageMeetingInputs(f.next,Array(10).fill({...bundle.files[0],content:'x'.repeat(INPUT_LIMIT/9)})),/exceeds limit/);
});
