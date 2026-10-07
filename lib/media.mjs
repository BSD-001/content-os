import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fail } from './store.mjs';
import { validatePng } from './canva.mjs';

export function requireMediaFiles(draft,directory) {
  if(!draft.media?.length||draft.media.length>18) throw fail('发布图片需要 1 至 18 张。',409);
  return draft.media.map(item=>{
    if(!/^[A-Za-z0-9_-]+\.png$/.test(item.filename)) throw fail('发布图片文件名不正确。',409);
    const filename=join(directory,item.filename);
    let bytes;
    try{bytes=readFileSync(filename);}catch{throw fail('已确认图片的本地文件缺失，请重新导出并确认。',409);}
    if(createHash('sha256').update(bytes).digest('hex')!==item.sha256) throw fail('图片文件已经变化，请重新导出并确认最终图文。',409);
    validatePng(bytes);
    // 传递已校验的固定字节，避免等待网页期间本地文件变化后被上传。
    return {name:item.filename,mimeType:'image/png',buffer:bytes};
  });
}
