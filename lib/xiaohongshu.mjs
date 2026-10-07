import { fail,now,normalizeMetrics } from './store.mjs';
import { randomUUID } from 'node:crypto';

const homeUrl='https://creator.xiaohongshu.com/new/home';
const managerUrl='https://creator.xiaohongshu.com/new/note-manager';
const publisherUrl='https://creator.xiaohongshu.com/publish/publish';
const metricsUrl='https://creator.xiaohongshu.com/statistics/data-analysis';
async function officialPage(browsers,id,url) {
  const context=await browsers.context(id);
  let page=context.pages().find(p=>p.url().split('?')[0]===url);
  if(!page) { page=await context.newPage(); await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000}); }
  return page;
}
export async function verifyXhs(browsers,store,id) {
  const page=await officialPage(browsers,id,homeUrl);
  await page.reload({waitUntil:'domcontentloaded'});
  try { await page.waitForFunction(()=>/小红书(?:号|账号)\s*[:：]?\s*[A-Za-z0-9_-]+/.test(document.body.innerText),null,{timeout:20000}); }
  catch { throw fail('官方首页未显示可核对的账号，请亲自登录并完成验证码。',409); }
  const text=await page.locator('body').innerText();
  const identity=text.match(/小红书(?:号|账号)\s*[:：]?\s*([A-Za-z0-9_-]+)/)?.[1];
  const account=store.requireAccount(id);
  if(account.platformIdentity&&account.platformIdentity!==identity) throw fail('当前登录身份与已绑定账号不一致，已停止；请检查专用窗口。',409);
  if(store.list('accounts').some(a=>a.id!==id&&a.platformIdentity===identity)) throw fail('该平台身份已绑定另一个账号，已停止。',409);
  store.put('accounts',{...account,platformIdentity:identity});
  const previous=store.get('connections',id);
  return store.put('connections',{...previous,id,status:'pending',identity,capabilities:{...previous?.capabilities,identity:true},message:previous?.capabilities?.published?'官方身份已核对，本项目已有真实发布实证；详细数据仍以当前权限和读取结果为准。':'官方账号身份已核对；发布提交和详细数据尚待真实验证。'});
}
export async function requireXhsIdentity(browsers,store,id) {
  const account=store.requireAccount(id);
  if(!account.platformIdentity) throw fail('请先绑定当前账号的平台身份。',409);
  const verified=await verifyXhs(browsers,store,id);
  if(verified.identity!==account.platformIdentity) throw fail('平台身份不一致，已停止。',409);
}
export async function readNotes(browsers,store,id,tab=null) {
  await requireXhsIdentity(browsers,store,id);
  const page=await officialPage(browsers,id,managerUrl);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('已发布',{exact:true}).filter({visible:true}).first().waitFor({timeout:20000});
  if(tab) { await page.getByText(tab,{exact:true}).filter({visible:true}).first().click(); await page.waitForTimeout(700); }
  await page.waitForFunction(()=>!!document.querySelector('.note-card')||/没有找到相关笔记|暂无笔记/.test(document.body.innerText),null,{timeout:20000});
  const notes=await page.locator('.note-card').evaluateAll(cards=>cards.map(card=>{
    let tracking={};try{tracking=JSON.parse(card.getAttribute('data-impression')||'{}');}catch{}
    return {noteId:tracking.noteTarget?.value?.noteId,title:card.querySelector('.note-card__title')?.textContent.trim(),time:card.querySelector('.note-card__time')?.textContent.trim()};
  }).filter(note=>note.noteId));
  return {page,notes};
}
export async function syncXhsMetrics(browsers,store,id) {
  await requireXhsIdentity(browsers,store,id);
  const page=await officialPage(browsers,id,metricsUrl);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('笔记数据',{exact:true}).first().waitFor({timeout:20000});
  // 标题先于权限区域加载，等权限提示或数据内容出现后再判断。
  await page.waitForFunction(()=>/暂未开通数据权限|数据权限申请中|暂无数据|暂无笔记/.test(document.body.innerText)||!!document.querySelector('table tbody tr'),null,{timeout:15000}).catch(()=>{});
  const text=await page.locator('body').innerText();
  if(/暂未开通数据权限|数据权限申请中/.test(text)) throw fail(`当前账号的官方详细数据权限尚未开通。${id==='a'?'账号 A 已申请，需次日查看。':''}未保存任何推测指标。`,409);
  const rows=await page.locator('table').evaluateAll(tables=>tables.flatMap(table=>{
    const headers=[...table.querySelectorAll('thead th')].map(el=>el.textContent.trim());
    return [...table.querySelectorAll('tbody tr')].map(row=>{
      const anchor=row.querySelector('a[href*="/explore/"],a[href*="/discovery/item/"]');
      return anchor?{href:anchor.href,title:anchor.textContent.trim(),headers,cells:[...row.querySelectorAll('td')].map(el=>el.textContent.trim())}:null;
    }).filter(Boolean);
  }));
  const projectNotes=new Set(store.list('drafts',id).filter(draft=>draft.state==='published'&&draft.noteId).map(draft=>draft.noteId));
  const parsed=parseMetricsRows(rows).filter(item=>projectNotes.has(item.noteId));
  if(!parsed.length) throw fail('尚未识别到本项目已发布笔记的明确指标数据；旧笔记不计入，未保存推测指标。表格解析仍待权限开通后实测。',409);
  const observedAt=now();
  for(const item of parsed) store.put('metrics',{...item,id:randomUUID(),accountId:id,observedAt,source:'official_browser',page:metricsUrl});
  await browsers.capture(id,'按笔记读取官方指标',page);
  return {count:parsed.length,message:'已按明确表头读取 '+parsed.length+' 篇官方笔记数据。'};
}
export function parseMetricsRows(rows) {
  const mapping={'阅读量':'views','观看量':'views','曝光量':'impressions','点赞量':'likes','点赞':'likes','收藏量':'saves','收藏':'saves','评论量':'comments','评论':'comments','分享量':'shares','分享':'shares','涨粉量':'followers'};
  return rows.flatMap(row=>{
    const noteId=row.href.match(/\/(?:explore|discovery\/item)\/([A-Za-z0-9]+)/)?.[1];
    if(!noteId) return [];
    const values=normalizeMetrics({});
    row.headers.forEach((label,index)=>{
      const key=mapping[label];
      const match=row.cells[index]?.replace(/,/g,'').match(/^(\d+(?:\.\d+)?)\s*(万|亿)?$/);
      if(key&&match) values[key]=Number(match[1])*(match[2]==='万'?1e4:match[2]==='亿'?1e8:1);
    });
    return Object.values(values).some(v=>v!==null)?[{noteId,title:row.title,values,rawLabels:row.headers,rawValues:row.cells}]:[];
  });
}
export async function prepareXhs(browsers,store,id,snapshot,files) {
  await requireXhsIdentity(browsers,store,id);
  const before=await readNotes(browsers,store,id);
  const context=await browsers.context(id);
  const page=await context.newPage();
  await page.goto(publisherUrl,{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('input[type="file"]').waitFor({state:'attached',timeout:20000});
  if((await page.locator('body').innerText()).includes('还未绑定手机号')) throw fail('官方发布页要求先在 App 绑定手机号，已停止上传。',409);
  await page.locator('.creator-tab').filter({hasText:'上传图文'}).last().click();
  await page.locator('input[type="file"][accept*=".png"]').setInputFiles(files);
  const title=page.getByPlaceholder('填写标题会有更多赞哦');
  await title.waitFor({timeout:30000});
  const guide=page.getByRole('button',{name:'关闭新功能引导',exact:true});
  if(await guide.isVisible()) await guide.click();
  await title.fill(snapshot.title);
  const editor=page.locator('[contenteditable="true"][role="textbox"]');
  await editor.fill(snapshot.body);
  if(snapshot.tags.length) {await editor.press('Control+End');await editor.press('Enter');await editor.press('Enter');}
  for(const tag of snapshot.tags) {
    const name='#'+tag.replace(/^#/,'');
    await editor.pressSequentially(name);
    const topic=page.getByText(name,{exact:true}).and(page.locator('span.name')).filter({visible:true});
    await topic.waitFor({timeout:10000});
    await topic.click();
  }
  await editor.press('Escape');
  await page.waitForFunction(count=>document.querySelector('.publish-page-content-media')?.innerText.includes(count+'/18'),files.length,{timeout:30000});
  const formProof=await verifyXhsForm(page,snapshot,files);
  return {page,beforeNoteIds:before.notes.map(note=>note.noteId),formProof};
}
export async function verifyXhsForm(page,snapshot,files) {
  const title=await page.getByPlaceholder('填写标题会有更多赞哦').inputValue();
  const editor=page.locator('[contenteditable="true"][role="textbox"]');
  const plain=await editor.evaluate(el=>[...el.children].map(paragraph=>{const clone=paragraph.cloneNode(true);clone.querySelectorAll('.content-hide').forEach(item=>item.remove());return clone.textContent;}).join('\n'));
  const topics=await editor.locator('a.tiptap-topic').evaluateAll(els=>els.map(el=>JSON.parse(el.getAttribute('data-topic'))));
  const expected=snapshot.body+'\n\n'+snapshot.tags.map(tag=>'#'+tag.replace(/^#/,'')).join(' ');
  if(title!==snapshot.title||plain.replace(/\s+/g,' ').trim()!==expected.replace(/\s+/g,' ').trim()||JSON.stringify(topics.map(item=>item.name))!==JSON.stringify(snapshot.tags.map(tag=>tag.replace(/^#/,'')))) throw fail('官方标题、正文或已关联话题与最终确认稿不一致，未点击发布。',409);
  return {title,textVerified:true,topics,images:await verifyUploadedImages(page,files)};
}
export async function verifyUploadedImages(page,files) {
  const result=await page.evaluate(async expected=>{
    const images=[...document.querySelectorAll('.publish-page-content-media img')].filter(el=>el.getClientRects().length);
    const pixels=async blob=>{
      const image=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=108;canvas.height=144;
      const context=canvas.getContext('2d');context.drawImage(image,0,0,108,144);image.close();return context.getImageData(0,0,108,144).data;
    };
    const originals=await Promise.all(expected.map(async encoded=>pixels(new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],{type:'image/png'}))));
    const uploaded=await Promise.all(images.map(async image=>pixels(await(await fetch(image.src)).blob())));
    const differences=uploaded.map(actual=>originals.map(source=>{let sum=0;for(let i=0;i<source.length;i++)if(i%4!==3)sum+=Math.abs(source[i]-actual[i]);return sum/(source.length/4*3);}));
    return {count:images.length,differences};
  },files.map(file=>file.buffer.toString('base64')));
  // 平台预览文件可能重新编码；比较解码后的画面和顺序，不误用源文件的字节哈希。
  if(result.count!==files.length||result.differences.some((row,index)=>row.indexOf(Math.min(...row))!==index||row[index]>4)) throw fail('官方上传预览与已确认图片的内容或顺序不能核对，未点击发布。',409);
  return {...result,method:'平台预览与确认图片的缩小像素对比',orderedMatch:true};
}
export async function publisherButton(browsers,id,page) {
  // 原生发布按钮位于封闭组件，读取浏览器无障碍树并按真实按钮边界定位。
  const session=await(await browsers.context(id)).newCDPSession(page);
  try {
    const {nodes}=await session.send('Accessibility.getFullAXTree');
    const targets=nodes.filter(n=>!n.ignored&&n.role?.value==='button'&&n.name?.value==='发布'&&!n.properties?.some(p=>p.name==='disabled'&&p.value?.value));
    if(targets.length!==1||!targets[0].backendDOMNodeId) throw fail('当前官方发布按钮不能唯一核对，未点击。',409);
    const {model}=await session.send('DOM.getBoxModel',{backendNodeId:targets[0].backendDOMNodeId});
    const points=model.border;
    return {x:(points[0]+points[2]+points[4]+points[6])/4,y:(points[1]+points[3]+points[5]+points[7])/4};
  } finally {await session.detach();}
}
export async function reconcileXhs(browsers,store,id,draftId) {
  const draft=store.requireDraft(id,draftId);
  const attempt=store.list('attempts',id).find(item=>item.draftId===draftId);
  if(!attempt) throw fail('该稿件没有提交记录。',409);
  const all=await readNotes(browsers,store,id);
  const matches=draft.noteId?all.notes.filter(note=>note.noteId===draft.noteId):all.notes.filter(note=>note.title===attempt.snapshot.title&&!attempt.beforeNoteIds?.includes(note.noteId)&&Date.parse(note.time.replace(' ','T')+':00+08:00')>=Date.parse(attempt.startedAt)-120000);
  if(matches.length!==1) return {draft,message:'官方后台尚不能唯一关联本次提交，保持结果待核对；不会重复发布。'};
  const note=matches[0];
  const published=await readNotes(browsers,store,id,'已发布');
  const state=published.notes.some(item=>item.noteId===note.noteId)?'published':'submitted';
  store.put('attempts',{...attempt,status:state,noteId:note.noteId,checkedAt:now()});
  const timestamp=Date.parse(note.time.replace(' ','T')+':00+08:00');
  const updated=store.put('drafts',{...draft,state,noteId:note.noteId,lastError:null,platformPublishTime:note.time,publicationCheckedAt:now(),publishedAt:state==='published'&&Number.isFinite(timestamp)?new Date(timestamp).toISOString():null});
  store.recordEvidence({connection:id,kind:'官方笔记列表核对提交结果',status:'observed',noteId:note.noteId,draftId,state});
  await browsers.capture(id,'官方发布状态核对',published.page);
  return {draft:updated,message:state==='published'?'官方已发布列表已核对该笔记。':'官方已记录笔记，尚未在已发布列表核对。'};
}
