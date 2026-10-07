import express from 'express';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, fail, now, normalizeMetrics, validateContent } from './lib/store.mjs';
import { DeepSeek } from './lib/ai.mjs';
import { Browsers } from './lib/browser.mjs';
import { createNativeDesign, exportNativeDesign, openDesign, verifyNativeDesign,applyCartoonStyle } from './lib/canva.mjs';
import { prepareXhs, publisherButton, requireXhsIdentity, reconcileXhs } from './lib/xiaohongshu.mjs';
import { requireMediaFiles } from './lib/media.mjs';
import { isCartoonStyle } from './public/cartoon-styles.js';
import { exportLocalPngs, requireCurrentExport } from './lib/local-export.mjs';

const root = resolve(import.meta.dirname);
const dataDir = resolve(process.env.CONTENT_OS_DATA || join(root, 'data'));
mkdirSync(dataDir, { recursive: true });
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const credentialFile = join(dataDir, 'credentials.json');
const credentials = () => existsSync(credentialFile) ? JSON.parse(readFileSync(credentialFile, 'utf8')) : {};
const store = new Store(join(dataDir, 'content-os.sqlite'));
const browsers = new Browsers(dataDir, store);
const controlFile=join(dataDir,'runtime-controls.json');
const controls=()=>existsSync(controlFile)?JSON.parse(readFileSync(controlFile,'utf8')):{};
const ai = new DeepSeek(credentials,controls,value=>writeFileSync(controlFile,JSON.stringify(value,null,2)));
const requirePlatformWrite=(draft,operation='canva')=>{
  const current=controls(),permission=current.canvaPermission;
  if(operation==='publish') return store.requirePublishPermission(draft,current.publishPermission);
  // 本次仅许可指定稿件的可画制作，不能由此解除小红书上传发布暂停。
  const allowed=draft&&permission?.accountId===draft.accountId&&permission.draftId===draft.id&&permission.version===draft.version&&permission.textHash===draft.textApproval?.hash;
  if(current.externalWritesPaused&&!allowed) throw fail('平台内容写入仍暂停；仅已明确许可的稿件可进行可画制作，小红书上传和发布需要单独确认。',423);
};
const writingAccount = id => { const account = store.requireAccount(id); return { name: account.name, positioning: account.positioning }; };
const busyDrafts = new Set();
const busyAccounts = new Set();
const app = express();
let port = Number(process.env.PORT || 0);
app.disable('x-powered-by');
app.use(express.json({ limit: '16mb' }));
app.use((req, res, next) => {
  if (!['127.0.0.1', 'localhost'].includes(req.hostname)) return res.status(403).json({ error: '仅允许本机访问。' });
  if (req.method !== 'GET' && (req.get('X-Content-OS') !== '1' || (req.get('Origin') && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.get('Origin'))))) return res.status(403).json({ error: '请求来源不正确。' });
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.static(join(root, 'public')));
app.use('/media',express.static(join(dataDir,'media')));
const route = fn => async (req, res, next) => { try { res.json(await fn(req, res)); } catch (error) { next(error); } };
// MVP 只做本地生产；保留旧实现和真实记录，但关闭外部平台操作入口。
app.use('/api', (req,res,next) => {
  if (/^\/connections\/(?!deepseek(?:\/|$))/.test(req.path) || /\/(?:metrics|review-next)(?:\/|$)/.test(req.path) || /\/(?:create-design|style-design|export-design|open-design|publish|reconcile|approve-final|approve-text)$/.test(req.path)) return res.status(423).json({error:'最小 MVP 已暂停平台自动操作与数据复盘；请导出图片后手动发布。'});
  next();
});

app.get('/api/state', route(() => ({ mode:'mvp', accounts: store.list('accounts').reverse(), connections: store.list('connections'), evidence: store.list('evidence'), settings: { deepseekConfigured: !!(credentials().deepseekKey || process.env.DEEPSEEK_API_KEY), model: credentials().model || 'deepseek-flash',paidAiPaused:!!controls().paidAiPaused,externalWritesPaused:true,testBudgetCny:controls().testBudgetCny,spentUpperBoundCny:controls().spentUpperBoundCny,pricing:controls().pricing?.[credentials().model||'deepseek-flash'],pricingCheckedAt:controls().pricingCheckedAt }, currentTime: now() })));
app.post('/api/connections/:id/open', route(req => browsers.open(req.params.id)));
app.get('/api/connections/:id/inspect', route(req => browsers.inspect(req.params.id)));
app.post('/api/connections/:id/capture', route(req => browsers.capture(req.params.id, req.body.label || '页面观察')));
app.post('/api/connections/:id/verify', route(async req => {
  if (req.params.id === 'deepseek') return verifyDeepSeek();
  if(req.params.id==='canva'&&controls().externalWritesPaused) throw fail('可画连接实测可能创建测试设计，已按你的要求暂停。',423);
  try { return await browsers.verify(req.params.id); }
  catch (error) {
    store.put('connections', { ...store.get('connections', req.params.id), id: req.params.id, status: 'failed', message: error.message });
    store.recordEvidence({ connection: req.params.id, kind: '连接检查', status: 'failed', message: error.message });
    throw error;
  }
}));
app.post('/api/settings', route(req => {
  const previous = credentials();
  const value = { ...previous, model: req.body.model?.trim() || previous.model || 'deepseek-flash' };
  const currentControl=controls();
  if(req.body.confirmPricing===true) {
    const input=Number(req.body.inputPrice),output=Number(req.body.outputPrice);
    if(!Number.isFinite(input)||!Number.isFinite(output)||input<=0||output<=0) throw fail('预算价格需填写大于零的人民币金额（每百万 tokens）。');
    currentControl.pricing={...currentControl.pricing,[value.model]:{input,output}};
    currentControl.pricingCheckedAt=now();
  }
  if (req.body.deepseekKey?.trim()) value.deepseekKey = req.body.deepseekKey.trim();
  writeFileSync(credentialFile, JSON.stringify(value, null, 2));
  if(typeof req.body.allowPaidAi==='boolean') writeFileSync(controlFile,JSON.stringify({...currentControl,paidAiPaused:!req.body.allowPaidAi,externalWritesPaused:true},null,2));
  return { message: '设置已保存到本机；密钥不会返回浏览器。' };
}));
async function verifyDeepSeek() {
  if(controls().paidAiPaused) throw fail('真实模型验证包含付费调用，已按你的要求暂停。',423);
  try {
    const result = await ai.verify();
    store.put('connections', { id: 'deepseek', status: 'verified', result });
    store.recordEvidence({ connection: 'deepseek', kind: '真实 API 调用', status: 'passed', result });
    return result;
  } catch (error) { store.put('connections', { id: 'deepseek', status: 'failed', message: error.message }); throw error; }
}
app.get('/api/health', route(() => ({ status: 'ok', application: 'Content OS', version: '0.1.4-mvp', pid:process.pid })));

app.get('/api/accounts/:accountId/data', route(req => {
  store.requireAccount(req.params.accountId);
  return Object.fromEntries(['materials', 'drafts', 'metrics', 'reviews', 'attempts'].map(table => [table, store.list(table, req.params.accountId)]));
}));
app.post('/api/accounts/:accountId', route(req => {
  const account = store.requireAccount(req.params.accountId);
  if (!req.body.name?.trim() || !req.body.positioning?.trim()) throw fail('账号名称和定位不能为空。');
  return store.put('accounts', { ...account, name: req.body.name.trim(), positioning: req.body.positioning.trim() });
}));
app.post('/api/accounts/:accountId/materials', route(req => {
  const accountId = req.params.accountId;
  store.requireAccount(accountId);
  if (!req.body.title?.trim() || !req.body.text?.trim()) throw fail('请填写素材名称和内容。');
  if (!['experience', 'notes', 'reference'].includes(req.body.type)) throw fail('请选择素材类型。');
  if (req.body.url) {
    let url;
    try { url = new URL(req.body.url); } catch { throw fail('请输入完整的参考链接。'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw fail('参考链接需要以 http 或 https 开头。');
  }
  const previous = req.body.id ? store.get('materials', req.body.id, accountId) : null;
  if (req.body.id && !previous) throw fail('该素材不属于当前账号。', 404);
  return store.put('materials', { id: previous?.id || randomUUID(), accountId, title: req.body.title.trim(), text: req.body.text.trim(), type: req.body.type, url: req.body.url?.trim() || '', createdAt: previous?.createdAt || now() });
}));
app.delete('/api/accounts/:accountId/materials/:id', route(req => {
  if (!store.get('materials', req.params.id, req.params.accountId)) throw fail('该素材不属于当前账号。', 404);
  if (store.list('drafts', req.params.accountId).some(d => d.materialIds.includes(req.params.id))) throw fail('已有稿件引用此素材，请保留以便核对来源。', 409);
  store.db.prepare('DELETE FROM materials WHERE id=? AND account_id=?').run(req.params.id, req.params.accountId);
  return { message: '素材已删除。' };
}));
app.post('/api/accounts/:accountId/drafts', route(req => store.createDraft(req.params.accountId, req.body)));

async function runDraft(accountId, id, fn) {
  if (busyDrafts.has(id)) throw fail('这份稿件正在处理，请等待完成。', 409);
  const before = store.requireDraft(accountId, id);
  if (['submitting', 'submitted', 'published', 'publish_unknown'].includes(before.state)) throw fail('已提交稿件不能重新生成。', 409);
  busyDrafts.add(id);
  store.put('drafts', { ...before, processing: true, lastError: null });
  try { return await fn(before); }
  catch (error) {
    const current = store.requireDraft(accountId, id);
    store.put('drafts', { ...current, lastError: error.message });
    throw error;
  } finally {
    const current = store.requireDraft(accountId, id);
    store.put('drafts', { ...current, processing: false });
    busyDrafts.delete(id);
  }
}
app.post('/api/accounts/:accountId/drafts/:id/generate', route(req => runDraft(req.params.accountId, req.params.id, async draft => {
  const account = writingAccount(draft.accountId);
  const materials = store.materialSelection(draft.accountId, draft.materialIds);
  const review = draft.reviewId ? store.get('reviews', draft.reviewId, draft.accountId) : null;
  let sources = [];
  let research = null;
  const result = await ai.json('writer', { account, topic: draft.topic, materials, research, sources, feedback: review?.result || null });
  validateContent(result.value);
  const generated = store.saveContent(draft.accountId, draft.id, result.value);
  store.put('drafts', { ...generated, sources, inputMaterials: materials, generation: { model: result.model, usage: result.usage, at: now() } });
  const audit = await ai.json('reviewer', { content: result.value, materials, sources });
  return store.put('drafts', { ...store.requireDraft(draft.accountId, draft.id), audit: audit.value });
})));
app.post('/api/accounts/:accountId/drafts/:id/content', route(req => runDraft(req.params.accountId, req.params.id, async draft => {
  return store.saveContent(draft.accountId, draft.id, req.body.content);
})));
app.post('/api/accounts/:accountId/drafts/:id/render-png', route(req => runDraft(req.params.accountId, req.params.id, async draft => {
  validateContent(draft.content);
  const visualPlan=store.planCartoonDesign(draft);
  const pngExport=await exportLocalPngs(draft,dataDir,visualPlan);
  return store.put('drafts',{...store.requireDraft(draft.accountId,draft.id),pngExport,media:pngExport.media,state:'png_ready',finishedAt:now(),finalApproval:null});
})));
app.get('/api/accounts/:accountId/drafts/:id/download', (req,res,next) => {
  try {
    const draft=store.requireDraft(req.params.accountId,req.params.id);
    const file=requireCurrentExport(draft,dataDir);
    res.download(file,`${draft.accountId}-图文-v${draft.version}.zip`);
  } catch(error) {next(error);}
});
app.post('/api/accounts/:accountId/drafts/:id/audit', route(req => runDraft(req.params.accountId, req.params.id, async draft => {
  validateContent(draft.content);
  const materials=store.materialSelection(draft.accountId,draft.materialIds);
  const audit = await ai.json('reviewer', { content: draft.content, materials, sources: draft.sources });
  return store.put('drafts', { ...draft, audit: audit.value,auditInputMaterials:materials, state: 'text_review', textApproval: null, finalApproval: null });
})));
app.post('/api/accounts/:accountId/drafts/:id/approve-text', route(req => {
  if (busyDrafts.has(req.params.id)) throw fail('请等待审稿完成。', 409);
  return store.approveText(req.params.accountId, req.params.id);
}));
app.post('/api/accounts/:accountId/drafts/:id/approve-final', route(req => {
  if(busyDrafts.has(req.params.id)) throw fail('请等待当前稿件的处理完成。',409);
  requireMediaFiles(store.requireDraft(req.params.accountId,req.params.id),join(dataDir,'media'));
  return store.approveFinal(req.params.accountId,req.params.id);
}));
app.post('/api/accounts/:accountId/drafts/:id/create-design', route(req => runDraft(req.params.accountId, req.params.id, async draft => {
  requirePlatformWrite(draft);
  store.requireTextApproval(draft);
  if (draft.design?.cardsCompleted===draft.content.cards.length) throw fail('已有完整可画设计，请打开现有设计或导出，避免重复创建。', 409);
  const title=`Content OS · ${store.requireAccount(draft.accountId).name} · ${draft.content.title}`;
  const plan=store.planCartoonDesign(draft);
  const design=await createNativeDesign(browsers,draft.content,title,design=>store.put('drafts',{...store.requireDraft(draft.accountId,draft.id),design}),draft.design,plan);
  store.recordEvidence({connection:'canva',kind:'官网直接创建原生可编辑多页中文设计',status:'passed',draftId:draft.id,designUrl:design.url});
  return store.put('drafts',{...store.requireDraft(draft.accountId,draft.id),design,state:'text_approved',lastError:null});
})));
app.post('/api/accounts/:accountId/drafts/:id/open-design',route(async req=>{
  const draft=store.requireDraft(req.params.accountId,req.params.id);
  if(!draft.design?.url) throw fail('这份稿件还没有可画设计。',409);
  await (await openDesign(browsers,draft.design.url)).bringToFront();
  return {message:'已在专用可画窗口打开现有设计。'};
}));
app.post('/api/accounts/:accountId/drafts/:id/style-design',route(req=>runDraft(req.params.accountId,req.params.id,async draft=>{
  requirePlatformWrite(draft);
  store.requireTextApproval(draft);
  if(!draft.design||draft.design.cardsCompleted!==draft.content.cards.length) throw fail('请先完成可画设计，再应用本篇卡通风格。',409);
  const plan=store.planCartoonDesign(draft);
  const layoutHistory=draft.media.length?[...(draft.layoutHistory||[]),{at:now(),reason:'应用本篇卡通风格',design:draft.design,media:draft.media}]:draft.layoutHistory||[];
  store.put('drafts',{...draft,visualPlan:plan,layoutHistory,layoutVersion:(draft.layoutVersion||1)+1,media:[],state:'text_approved',finalApproval:null,finishedAt:null});
  const design=await applyCartoonStyle(browsers,{...draft.design,visualPlan:draft.design.visualPlan||plan},join(dataDir,'design-backgrounds'),design=>store.put('drafts',{...store.requireDraft(draft.accountId,draft.id),design}));
  return store.put('drafts',{...store.requireDraft(draft.accountId,draft.id),design});
})));
app.post('/api/accounts/:accountId/drafts/:id/export-design', route(req => runDraft(req.params.accountId,req.params.id,async draft=>{
  store.requireTextApproval(draft);
  if(!draft.design||draft.design.cardsCompleted!==draft.content.cards.length) throw fail('设计尚未完成，请先检查已有可画设计，不会自动重复创建。',409);
  const design=await verifyNativeDesign(browsers,draft.design);
  const media=await exportNativeDesign(browsers,design,join(dataDir,'media'),`${draft.accountId}-${draft.id}-v${draft.version}`);
  if(isCartoonStyle(design.style?.id)&&design.style.appliedPages===draft.content.cards.length) design.style={...design.style,verifiedMediaHashes:media.map(m=>m.sha256)};
  store.recordEvidence({connection:'canva',kind:'实际运营稿件官网下载PNG，待本人确认最终图文',status:'observed',draftId:draft.id,media});
  return store.put('drafts',{...store.requireDraft(draft.accountId,draft.id),design,media,state:'design_ready',finalApproval:null,finishedAt:null,lastError:null});
})));
app.post('/api/accounts/:accountId/drafts/:id/publish', route(req => runDraft(req.params.accountId,req.params.id,async draft=>{
  requirePlatformWrite(draft,'publish');
  if (!draft.finalApproval || draft.state !== 'final_approved') throw fail('请先确认当前版本的最终图文。', 409);
  const snapshot=store.requireFinalApproval(draft);
  const combined=snapshot.body+'\n\n'+snapshot.tags.map(tag=>'#'+tag.replace(/^#/, '')).join(' ');
  if(snapshot.title.length>20||combined.length>1000) throw fail('标题超出 20 字或正文与话题超出 1000 字，请修改并重新确认。',409);
  const files=requireMediaFiles(draft,join(dataDir,'media'));
  const prepared=await prepareXhs(browsers,store,draft.accountId,snapshot,files);
  store.recordEvidence({connection:draft.accountId,kind:'本篇真实上传表单及图片顺序核对，尚未点击发布',status:'passed',draftId:draft.id,formProof:prepared.formProof});
  await browsers.capture(draft.accountId,'本篇真实上传表单核对',prepared.page);
  await requireXhsIdentity(browsers,store,draft.accountId);
  const target=await publisherButton(browsers,draft.accountId,prepared.page);
  const viewport=prepared.page.viewportSize();
  if(target.x<0||target.y<0||target.x>viewport.width||target.y>viewport.height) throw fail('发布按钮不在可核对视口，未点击。',409);
  let attempt=store.beginPublish(draft.accountId,draft.id);
  attempt=store.put('attempts',{...attempt,beforeNoteIds:prepared.beforeNoteIds,clickedAt:now()});
  const currentControls=controls();
  writeFileSync(controlFile,JSON.stringify({...currentControls,publishPermission:{...currentControls.publishPermission,consumedAt:now(),attemptId:attempt.id}},null,2));
  try {
    await prepared.page.mouse.click(target.x,target.y);
    // 点击不能冒充平台接受；先标待核对，再以官方新增笔记和已发布列表确认。
    store.put('attempts',{...attempt,status:'unknown'});
    store.put('drafts',{...store.requireDraft(draft.accountId,draft.id),state:'publish_unknown'});
    await prepared.page.waitForTimeout(2000);
    return await reconcileXhs(browsers,store,draft.accountId,draft.id);
  } catch(error) {
    store.put('attempts',{...store.get('attempts',attempt.id,draft.accountId),status:'unknown',message:'点击发布后未能核对结果，请先查看官方后台，不重复提交。'});
    store.put('drafts',{...store.requireDraft(draft.accountId,draft.id),state:'publish_unknown',lastError:'发布结果待核对，不会自动重发。'});
    throw fail('发布结果待核对，请使用“核对官方发布结果”；不会自动重发。',409);
  }
})));
app.post('/api/accounts/:accountId/drafts/:id/reconcile',route(req=>reconcileXhs(browsers,store,req.params.accountId,req.params.id)));

app.post('/api/accounts/:accountId/metrics', route(req => {
  const accountId = req.params.accountId;
  store.requireAccount(accountId);
  const noteId = req.body.noteId?.trim();
  if (!noteId) throw fail('请填写官方笔记标识。');
  if(!store.list('drafts',accountId).some(draft=>draft.state==='published'&&draft.noteId===noteId)) throw fail('只能补录本项目当前账号已发布笔记的数据，旧笔记不计入。',409);
  const observedAt = req.body.observedAt || now();
  if (!Number.isFinite(Date.parse(observedAt))) throw fail('采集时间格式不正确。');
  return store.put('metrics', { id: randomUUID(), accountId, noteId, title: req.body.title?.trim() || '', observedAt, source: 'manual', values: normalizeMetrics(req.body.values || {}), rawLabels: null });
}));
app.post('/api/accounts/:accountId/metrics/sync', route(async req => {
  try { return await browsers.syncMetrics(req.params.accountId); }
  catch (error) {
    store.recordEvidence({ connection: req.params.accountId, kind: '自动读取笔记数据', status: 'failed', message: error.message });
    throw error;
  }
}));
app.post('/api/accounts/:accountId/review-next', route(async req => {
  const accountId = req.params.accountId;
  const account = writingAccount(accountId);
  if (busyAccounts.has(accountId)) throw fail('当前账号正在复盘，请等待完成。', 409);
  busyAccounts.add(accountId);
  try {
    const drafts = store.list('drafts', accountId);
    const projectNotes=new Set(drafts.filter(draft=>draft.state==='published'&&draft.noteId).map(draft=>draft.noteId));
    if(projectNotes.size<2) throw fail('第三篇复盘需要本账号至少两篇本项目已发布笔记，当前不足两篇。',409);
    let syncWarning = null;
    try { await browsers.syncMetrics(accountId); }
    catch (error) {
      syncWarning = error.message;
      store.recordEvidence({ connection: accountId, kind: '复盘前自动刷新数据', status: 'failed', message: error.message });
    }
    const metrics = store.list('metrics', accountId).filter(metric=>projectNotes.has(metric.noteId));
    const latest = [...new Map(metrics.map(m => m.noteId).map(noteId => [noteId, metrics.filter(m => m.noteId === noteId).sort((a,b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0]])).values()];
    if(latest.length<2) throw fail('第三篇复盘需要本账号至少两篇本项目已发布笔记的真实数据；旧笔记和重复快照不计入。',409);
    const result = await ai.json('analyst', { account, sampleSize: latest.length, metrics: latest, drafts: drafts.filter(d => latest.some(m => m.noteId === d.noteId)).map(d => ({ noteId: d.noteId, content: d.content })) });
    if (!Array.isArray(result.value.topics) || !result.value.topics[0]?.trim()) throw fail('复盘未返回可用选题，请重试。', 502);
    if (!Array.isArray(result.value.evidence) || !result.value.evidence.length || result.value.evidence.some(e => !latest.some(m => m.noteId === e.noteId))) throw fail('复盘引用的数据无法核对，未生成下一轮稿件。', 502);
    const review = store.put('reviews', { id: randomUUID(), accountId, metricIds: latest.map(m => m.id), sampleSize: latest.length, result: result.value, model: result.model, syncWarning, createdAt: now() });
    const materialIds = store.list('materials', accountId).map(m => m.id);
    const draft = store.createDraft(accountId, { topic: result.value.topics[0], materialIds, reviewId: review.id });
    const written = await ai.json('writer', { account, topic: draft.topic, materials: store.materialSelection(accountId, materialIds), feedback: review.result });
    validateContent(written.value);
    const saved = store.saveContent(accountId, draft.id, written.value);
    const audit = await ai.json('reviewer', { content: written.value, materials: store.materialSelection(accountId, materialIds), feedback: review.result });
    const next = store.put('drafts', { ...saved, audit: audit.value, generation: { model: written.model, usage: written.usage, at: now() } });
    return { review, draft: next };
  } finally { busyAccounts.delete(accountId); }
}));

app.use('/api', (req, res) => res.status(404).json({ error: '该操作尚未完成实际连接验证，暂不能执行。' }));

app.use((error, req, res, next) => {
  const status = error.status || 500;
  // 不把上游响应、堆栈或凭据返回给网页。
  res.status(status).json({ error: status === 500 ? '操作未完成，请重试；已有内容已保留。' : error.message });
});
const server = app.listen(port, '127.0.0.1', error => {
  if (error) {
    console.error(`Content OS 未启动：端口 ${port} 无法监听（${error.code}）。`);
    process.exitCode = 1;
    return;
  }
  port=server.address().port;
  writeFileSync(join(dataDir,'server-info.json'),JSON.stringify({pid:process.pid,url:`http://127.0.0.1:${port}`,startedAt:now()}));
  console.log(`Content OS 已启动：http://127.0.0.1:${port}`);
});
process.on('SIGINT', async () => { await browsers.close(); store.close(); server.close(); process.exit(0); });
