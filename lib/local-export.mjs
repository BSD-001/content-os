import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { chromium } from 'playwright';
import { cartoonBackground, cartoonStyleFor } from './cartoon.mjs';
import { digest, fail, now, validateContent } from './store.mjs';

const esc = value => String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// PNG 已经压缩，ZIP 直接存储；使用 Node 的 CRC32，不增加压缩依赖。
export function packZip(entries) {
  const files=[],directory=[];
  let offset=0;
  for(const entry of entries) {
    const name=Buffer.from(entry.name,'utf8'),bytes=entry.bytes,checksum=crc32(bytes);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);
    local.writeUInt16LE(33,12);local.writeUInt32LE(checksum,14);
    local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
    files.push(local,name,bytes);
    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);
    central.writeUInt16LE(33,14);central.writeUInt32LE(checksum,16);
    central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    directory.push(central,name);offset+=local.length+name.length+bytes.length;
  }
  const size=directory.reduce((sum,item)=>sum+item.length,0),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...files,...directory,end]);
}

export async function exportLocalPngs(draft,dataDir,plan) {
  validateContent(draft.content);
  if(draft.content.cards.length>9) throw fail('最多导出 9 页卡片，请减少页数。');
  const directory=join(dataDir,'media');
  mkdirSync(directory,{recursive:true});
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
  const rendered=[];
  const style=cartoonStyleFor(plan.styleId);
  try {
    const page=await browser.newPage({viewport:{width:1080,height:1440},deviceScaleFactor:1});
    // 只渲染已内嵌的 SVG 和文本，禁止卡片触发外部网络请求。
    await page.route('**/*',route=>route.abort());
    for(const [index,card] of draft.content.cards.entries()) {
      await page.setContent(`<style>
        html,body{margin:0;width:1080px;height:1440px;overflow:hidden;font-family:"Microsoft YaHei","Segoe UI Emoji",sans-serif;color:${style.outline}}
        body>svg{position:absolute;inset:0}
        .box{position:absolute;white-space:pre-wrap;overflow-wrap:anywhere;line-break:strict}
        .heading{left:110px;top:90px;width:860px;height:185px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:64px;line-height:1.25;font-weight:700}
        .heading>div{max-width:100%;text-wrap:balance}
        .text{left:116px;top:408px;width:848px;height:535px;font-size:46px;line-height:1.55}
        .footer{left:284px;top:1325px;width:512px;font-size:29px;text-align:center;white-space:nowrap}
      </style>${cartoonBackground(index,plan)}
      <div class="box heading"><div>${esc(card.heading)}</div></div>
      <div class="box text"><div>${esc(card.text)}</div></div>
      <div class="box footer">${index===0?'封面':`第 ${index+1} 页`} · ${index+1} / ${draft.content.cards.length}</div>`);
      await page.evaluate(()=>document.fonts.ready);
      const layout=await page.evaluate(()=>{
        const result=[];
        for(const [selector,minimum] of [['.heading',40],['.text',32]]) {
          const box=document.querySelector(selector),text=box.firstElementChild;
          let font=parseInt(getComputedStyle(box).fontSize);
          while((text.scrollHeight>box.clientHeight||text.scrollWidth>box.clientWidth)&&font>minimum) {font-=2;box.style.fontSize=font+'px';}
          result.push({selector,font,overflow:text.scrollHeight>box.clientHeight||text.scrollWidth>box.clientWidth});
        }
        return result;
      });
      if(layout.some(item=>item.overflow)) throw fail(`第 ${index+1} 页文字过长，无法保持清晰字号；请缩短文字或拆成两页。`,422);
      const bytes=await page.screenshot({type:'png',timeout:20000});
      rendered.push({bytes,layout});
    }
  } finally {await browser.close();}
  // 全部页面排版成功后再保存，失败时不把部分图片当成完整导出。
  const prefix=`${draft.accountId}-${draft.id}-v${draft.version}-local-${randomUUID()}`;
  const media=rendered.map(({bytes},index)=>{
    const filename=`${prefix}-${String(index+1).padStart(2,'0')}.png`;
    writeFileSync(join(directory,filename),bytes);
    return {filename,sha256:sha(bytes),width:1080,height:1440};
  });
  const content=draft.content;
  const copy=`${content.title}\n\n${content.body}\n\n${content.tags.map(tag=>'#'+tag.replace(/^#/, '')).join(' ')}\n`;
  const archive=`${prefix}.zip`;
  const zip=packZip([...rendered.map(({bytes},index)=>({name:`${String(index+1).padStart(2,'0')}.png`,bytes})),{name:'文案.txt',bytes:Buffer.from('\uFEFF'+copy,'utf8')}]);
  writeFileSync(join(directory,archive),zip);
  return {kind:'local-png',version:draft.version,contentHash:digest(content),styleId:plan.styleId,styleName:style.name,media,archive,archiveHash:sha(zip),layout:rendered.map(item=>item.layout),renderedAt:now()};
}

export function requireCurrentExport(draft,dataDir) {
  const item=draft.pngExport;
  if(!item||item.version!==draft.version||item.contentHash!==digest(draft.content)) throw fail('文字已修改，请重新生成预览再下载。',409);
  for(const media of [...item.media,{filename:item.archive,sha256:item.archiveHash}]) {
    if(basename(media.filename)!==media.filename) throw fail('导出文件名称不正确。',409);
    const file=join(dataDir,'media',media.filename);
    if(!existsSync(file)||sha(readFileSync(file))!==media.sha256) throw fail('导出文件缺失或已变化，请重新生成预览。',409);
  }
  return join(dataDir,'media',item.archive);
}

