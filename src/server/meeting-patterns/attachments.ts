import path from 'node:path';
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { type FileAttachment, matches, workflowValue } from '../../shared/meeting-workflows.js';

/** Resolve only declared UTF-8 attachments within the session checkout, with pinned SHA-256. */
export function resolveAttachments(cwd: string, value: Record<string,unknown>, attachments: FileAttachment[], inlineOnly = false) {
  const output=structuredClone(value);
  for(const a of attachments) {
    if(!matches(output,a.when))continue;
    const content=workflowValue(output,a.content); let bytes: Buffer;
    if(typeof content==='string') bytes=Buffer.from(content,'utf8');
    else {
      const name=workflowValue(output,a.path);
      if(inlineOnly || typeof name!=='string')throw Error('Missing inline attachment: '+a.content);
      const file=realpathSync(path.resolve(cwd,name));
      if(!file.startsWith(realpathSync(cwd)+path.sep)||statSync(file).size>a.maxBytes)throw Error('Attachment outside meeting or size limit');
      bytes=readFileSync(file);
    }
    if(bytes.length>a.maxBytes || createHash('sha256').update(bytes).digest('hex')!==workflowValue(output,a.sha256) || !Buffer.from(bytes.toString('utf8'),'utf8').equals(bytes)) throw Error('Attachment size, encoding or digest mismatch');
    const keys=a.content.split('.'); let target: Record<string,unknown>=output;
    for(const k of keys.slice(0,-1)) { const v=target[k]; if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Missing attachment parent'); target=v as Record<string,unknown>; }
    target[keys.at(-1)!]=bytes.toString('utf8');
  }
  if(Buffer.byteLength(JSON.stringify(output))>256*1024)throw Error('Resolved output exceeds 256 KiB');
  return output;
}
