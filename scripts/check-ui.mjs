import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { Store } from '../lib/store.mjs';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';

const output = resolve('output/playwright');
mkdirSync(output, { recursive: true });
const port = 8791;
const base = `http://127.0.0.1:${port}`;
const qaDirectory=resolve(output,`qa-data-${Date.now()}`);
mkdirSync(resolve(qaDirectory,'media'),{recursive:true});
writeFileSync(resolve(qaDirectory,'runtime-controls.json'),JSON.stringify({paidAiPaused:true,externalWritesPaused:true,testBudgetCny:5,spentUpperBoundCny:0}));
// 固件只用于本地界面保护检查，不能作为真实可画设计、审稿或运营数据。
const fixtureStore=new Store(resolve(qaDirectory,'content-os.sqlite'));
fixtureStore.put('accounts',{...fixtureStore.requireAccount('b'),platformIdentity:'隔离测试身份'});
const fixture=fixtureStore.createDraft('b',{topic:'隔离流程测试主题'});
const fixtureContent={title:'隔离测试稿',body:'这是本地界面测试固件，不是真实运营内容。',tags:['离线测试'],cards:[{heading:'测试标题',text:'本地测试样本，不用于真实发布。'}]};
fixtureStore.saveContent('b',fixture.id,fixtureContent,{summary:'离线审稿占位，不是真实模型结果',issues:[]});
fixtureStore.approveText('b',fixture.id);
const image=new PNG({width:1080,height:1440});image.data.fill(255);
for(let y=100;y<200;y++) for(let x=100;x<300;x++) {const index=(y*1080+x)*4;image.data[index]=0;image.data[index+1]=0;image.data[index+2]=0;}
const bytes=PNG.sync.write(image);
writeFileSync(resolve(qaDirectory,'media','qa-fixture.png'),bytes);
const fixtureHash=createHash('sha256').update(bytes).digest('hex');
// 风格字段也是隔离固件，仅验证确认约束，不证明这张测试图片是真实卡通设计。
fixtureStore.put('drafts',{...fixtureStore.requireDraft('b',fixture.id),state:'design_ready',design:{verifiedEditable:true,url:'https://www.canva.cn/design/QA/FIXTURE/edit',style:{id:'cartoon-comic-v1',name:'清爽漫画分镜风',appliedPages:1,verifiedMediaHashes:[fixtureHash]}},media:[{filename:'qa-fixture.png',sha256:fixtureHash}]});
fixtureStore.close();
const child = spawn(process.execPath, [resolve('server.mjs')], { env: { ...process.env, PORT: String(port), CONTENT_OS_DATA: qaDirectory, DEEPSEEK_API_KEY: '' }, stdio: 'pipe', windowsHide: true });
const errors = [];
const checks = [];
child.stderr.on('data', data => errors.push(data.toString()));
let browser;
try {
  for (let count = 0; count < 40; count++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true, args:['--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('heading', { name: '让内容，走完一整圈。' }).waitFor();
  for (const [hash, title] of [['overview','让内容，走完一整圈。'],['materials','你的素材，才是内容的底气。'],['studio','一篇内容，从这里开始。'],['analytics','让下一篇，有反馈可循。'],['settings','连接好工具，保留你的控制权。']]) {
    await page.goto(`${base}/#${hash}`);
    await page.getByRole('heading', { name: title }).waitFor();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: resolve(output, `${hash}.png`), fullPage: false });
    checks.push({ check: `五页导航：${hash}`, passed: true });
  }
  await page.goto(`${base}/#materials`);
  await page.getByLabel('素材名称').fill('仅用于离线 UI 测试的素材');
  await page.getByLabel('素材内容').fill('这是隔离测试数据库里的样本，不是真实运营经历。');
  await page.getByRole('button', { name: '保存到当前账号' }).click();
  await page.getByRole('heading', { name: '仅用于离线 UI 测试的素材' }).waitFor();
  await page.getByLabel('切换当前账号').selectOption('b');
  await page.getByText('先存一条真实经历，下一篇就有了起点。', { exact: true }).waitFor();
  if (await page.getByRole('heading', { name: '仅用于离线 UI 测试的素材' }).count()) throw new Error('素材跨账号显示');
  checks.push({ check: '浏览器实际操作：A 保存素材，B 不显示该素材', passed: true });
  const forbidden = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'Content-Type':'application/json', 'Origin':'https://untrusted.example', 'X-Content-OS':'1' }, body:'{}' });
  if (forbidden.status !== 403) throw new Error('未阻止跨来源写入');
  checks.push({ check: '跨来源写入请求被拒绝', passed: true });
  await page.goto(`${base}/?account=b&draft=${fixture.id}#studio`);
  await page.getByRole('heading',{name:'隔离流程测试主题',exact:true}).waitFor();
  if(!await page.getByRole('button',{name:'直接创建可画设计',exact:true}).isDisabled()||!await page.getByRole('button',{name:'重新生成并审稿',exact:true}).isDisabled()) throw Error('暂停时仍允许付费或平台写入');
  checks.push({check:'稿件直达链接正确选择 B，暂停时操作按钮禁用',passed:true});
  await page.getByText('新稿自动轮换奶油手帐、漫画分镜、彩色贴纸三套卡通风格；同篇多页保持一致。',{exact:false}).waitFor();
  if(await page.getByRole('button',{name:'我已确认最终图文',exact:true}).isDisabled()) throw Error('新卡通风格没有进入前端最终确认校验');
  checks.push({check:'工作台显示新稿风格轮换，已知漫画风格沿用确认约束',passed:true});
  await page.getByLabel('标题',{exact:true}).fill('用户尚未保存的修改');
  await page.getByRole('button',{name:'我已确认最终图文',exact:true}).click();
  await page.getByText('文字有未保存修改，请先保存修改并审稿。',{exact:true}).waitFor();
  let fixtureData=await(await fetch(`${base}/api/accounts/b/data`)).json();
  if(fixtureData.drafts[0].finalApproval) throw Error('未保存文字被错误确认');
  checks.push({check:'未保存的文字阻止最终确认',passed:true});
  await page.getByLabel('标题',{exact:true}).fill(fixtureContent.title);
  await page.getByRole('button',{name:'我已确认最终图文',exact:true}).click();
  await page.getByText('已确认当前最终图文版本。',{exact:true}).waitFor();
  fixtureData=await(await fetch(`${base}/api/accounts/b/data`)).json();
  if(fixtureData.drafts[0].finalApproval?.snapshot.body!==fixtureContent.body) throw Error('最终确认没有固定保存版本');
  checks.push({check:'本地最终确认固定文案和媒体版本，未操作真实平台',passed:true});
  for(const endpoint of [`/api/accounts/b/drafts/${fixture.id}/create-design`,`/api/accounts/b/drafts/${fixture.id}/style-design`,`/api/accounts/b/drafts/${fixture.id}/publish`,`/api/accounts/b/drafts/${fixture.id}/generate`,'/api/connections/deepseek/verify']) {
    const response=await fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Content-OS':'1'},body:'{}'});
    if(response.status!==423) throw Error('暂停权限未在后端阻止：'+endpoint);
  }
  checks.push({check:'后端阻止可画创建、小红书上传发布、生成和付费模型验证',passed:true});
  const oldMetric=await fetch(base+'/api/accounts/b/metrics',{method:'POST',headers:{'Content-Type':'application/json','X-Content-OS':'1'},body:JSON.stringify({noteId:'项目以外的旧笔记',values:{views:18}})});
  if(oldMetric.status!==409) throw Error('允许把旧笔记指标写入本项目');
  checks.push({check:'人工补录拒绝本项目以外的旧笔记数据',passed:true});
  const prematureReview=await fetch(base+'/api/accounts/b/review-next',{method:'POST',headers:{'Content-Type':'application/json','X-Content-OS':'1'},body:'{}'});
  if(prematureReview.status!==409||!(await prematureReview.json()).error.includes('不足两篇')) throw Error('第三篇复盘没有先检查本账号两篇已发布稿');
  checks.push({check:'不足两篇本项目已发布稿时不进入读取或模型复盘',passed:true});
  await page.waitForLoadState('networkidle');
  await page.screenshot({path:resolve(output,'studio-paused.png'),fullPage:false});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#overview`);
  await page.getByRole('heading', { name: '让内容，走完一整圈。' }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage:false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  if (overflow) throw new Error('窄屏存在整页横向溢出');
  checks.push({ check:'窄屏无整页横向溢出', passed:true });
  if (errors.length) throw new Error(errors.join('\n'));
  writeFileSync(resolve(output, 'ui-results.json'), JSON.stringify({ kind:'离线浏览器测试，不是平台闭环', at:new Date().toISOString(), checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, errors, output }));
} finally {
  if (browser) await browser.close();
  child.kill();
}
