// 隔离数据库与本地浏览器验收，不是真实发布、模型效果或数据闭环验证。
import { spawn } from 'node:child_process';
import { mkdirSync,writeFileSync,readFileSync,copyFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { crc32 } from 'node:zlib';

const output=resolve('output/playwright/mvp'),directory=join(output,'qa-'+Date.now());
mkdirSync(directory,{recursive:true});
writeFileSync(join(directory,'runtime-controls.json'),JSON.stringify({paidAiPaused:true,externalWritesPaused:true,testBudgetCny:5,spentUpperBoundCny:0}));
const checks=[],errors=[],external=[];
const child=spawn(process.execPath,[resolve('server.mjs')],{env:{...process.env,PORT:'0',CONTENT_OS_DATA:directory,DEEPSEEK_API_KEY:''},stdio:'pipe',windowsHide:true});
child.stderr.on('data',data=>{if(!String(data).includes('ExperimentalWarning')&&!String(data).includes('trace-warnings'))errors.push(String(data));});
let browser,page,base;
const call=async(path,body)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Content-OS':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await response.json();if(!response.ok)throw Error(result.error);return result;};
const check=(name,passed)=>{if(!passed)throw Error(name);checks.push({check:name,passed:true});};
const content={title:'学习计划，先写清四项信息',body:'这是 MVP 隔离测试文案，不用于真实运营。先填写目标、时间、当前水平与限制，再自己核对计划。',tags:['学习计划','AI学习'],cards:[
 {heading:'让 AI 排学习计划\n先给四项信息',text:'目标是什么？\n每天有多少时间？\n目前学到哪里？\n有哪些现实限制？\n\n先写清这些，再让 AI 帮你安排。'},
 {heading:'01 / 先写目标',text:'用具体任务代替“我要努力”。\n\n例如：这周读完一章资料，\n再用自己的话讲清三个概念。\n\n这是示例，请替换成你的目标。'},
 {heading:'02 / 时间与水平',text:'填写每天能投入的时间。\n说明已经掌握什么、哪里卡住。\n\n不知道的地方直接说不知道。\nAI 给出建议后，自己检查安排。'},
 {heading:'03 / 留下调整空间',text:'记录这周的课程与其他安排。\n给休息和临时任务留下空间。\n\n计划执行后，再根据实际情况调整。\n工具提供建议，决定仍由你做。'}
]};
function unzip(bytes){
 const entries=[];
 let offset=0;
 while(bytes.readUInt32LE(offset)===0x04034b50){
   const size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);
   const name=bytes.subarray(offset+30,offset+30+nameLength).toString('utf8'),start=offset+30+nameLength+extra,data=bytes.subarray(start,start+size);
   if(crc32(data)!==bytes.readUInt32LE(offset+14))throw Error('ZIP 校验失败');
   entries.push({name,bytes:data});offset=start+size;
 }
 return entries;
}
try{
 for(let count=0;count<40;count++){
   try{const info=JSON.parse(readFileSync(join(directory,'server-info.json'),'utf8'));base=info.url;if((await fetch(base+'/api/health')).ok)break;}catch{}
   await new Promise(resolve=>setTimeout(resolve,250));
 }
 check('系统自动选择端口并通过健康检查',!!base&&(await call('/api/health')).version==='0.1.4-mvp');
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
 page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==base){external.push(url.origin);return route.abort();}return route.continue();});
 await page.goto(base);
 for(const [hash,title] of [['overview','把一篇图文做好。'],['materials','你的素材，才是内容的底气。'],['studio','一篇内容，从这里开始。'],['analytics','数据复盘已暂停。'],['settings','设置好，开始创作。']]){
   await page.goto(base+'/#'+hash);await page.getByRole('heading',{name:title}).waitFor();
 }
 check('五页均可打开，暂停页没有自动运营按钮',await page.locator('[data-action="publish"],[data-action="sync-metrics"],[data-action="create-design"]').count()===0);
 await page.goto(base+'/#materials');
 await page.getByLabel('素材名称').fill('MVP 隔离测试素材');
 await page.getByLabel('素材内容').fill('本地流程验证样本，不是真实经历或运营成果。');
 await page.getByLabel('参考链接（选填）').fill('ftp://example.test/source');
 await page.getByRole('button',{name:'保存到当前账号'}).click();
 await page.getByText('参考链接需要以 http 或 https 开头。',{exact:true}).waitFor();
 check('保存校验失败保留已填写的素材',await page.getByLabel('素材名称').inputValue()==='MVP 隔离测试素材'&&await page.getByLabel('素材内容').inputValue()==='本地流程验证样本，不是真实经历或运营成果。');
 await page.getByLabel('参考链接（选填）').fill('');
 await page.getByRole('button',{name:'保存到当前账号'}).click();
 await page.getByRole('heading',{name:'MVP 隔离测试素材'}).waitFor();
 await page.getByLabel('切换当前账号').selectOption('b');
 await page.getByText('还没有素材，先存一条真实经历。',{exact:true}).waitFor();
 check('A 保存的素材不会出现在 B',await page.getByRole('heading',{name:'MVP 隔离测试素材'}).count()===0);
 await page.getByLabel('切换当前账号').selectOption('a');
 await page.goto(base+'/#studio');
 await page.getByLabel('这次想分享什么？').fill('MVP 四页卡通出图验收');
 await page.getByRole('button',{name:'保存主题，开始创作'}).click();
 await page.getByLabel('标题',{exact:true}).waitFor();
 await page.getByRole('button',{name:'＋ 加一页'}).click();
 check('编辑器可增加卡片页',await page.locator('.card-editor').count()===5);
 await page.locator('.card-editor').last().getByRole('button',{name:'删除本页'}).click();
 check('编辑器可删除卡片页',await page.locator('.card-editor').count()===4);
 await page.getByLabel('标题',{exact:true}).fill(content.title);
 await page.getByLabel('正文',{exact:true}).fill(content.body);
 await page.getByLabel('话题（空格分隔）').fill(content.tags.join(' '));
 for(let i=0;i<4;i++){
   await page.locator('[name="heading-'+i+'"]').fill(content.cards[i].heading);
   await page.locator('[name="text-'+i+'"]').fill(content.cards[i].text);
 }
 await page.getByRole('button',{name:'保存文字',exact:true}).click();
 await page.getByText('文字已保存；图片预览已失效，请重新生成。',{exact:true}).waitFor();
 let a=await call('/api/accounts/a/data'),draft=a.drafts[0];
 check('手写文案保存成功，标题保留换行且无伪造模型审稿',draft.content.cards.length===4&&draft.content.cards[0].heading===content.cards[0].heading&&draft.audit===null);
 check('付费暂停时 AI 按钮禁用',await page.getByRole('button',{name:'AI 审稿当前文字'}).isDisabled());
 await page.getByRole('button',{name:'生成图片预览',exact:true}).click();
 await page.getByText('全部图片已生成，请逐页检查后下载。',{exact:true}).waitFor({timeout:60000});
 a=await call('/api/accounts/a/data');draft=a.drafts[0];
 check('实际本地渲染四张1080×1440 PNG，文字无溢出',draft.pngExport.media.length===4&&draft.pngExport.layout.every(items=>items.every(item=>!item.overflow&&item.font>=32)));
 await page.waitForLoadState('networkidle');
 await page.locator('.export-images').screenshot({path:join(output,'MVP四页图片预览.png')});
 await page.screenshot({path:join(output,'MVP工作台.png'),fullPage:true});
 const downloadPromise=page.waitForEvent('download');
 await page.getByRole('button',{name:'下载整篇 PNG（ZIP）'}).click();
 const download=await downloadPromise;
 const zipPath=join(output,'MVP四页图文实测.zip');await download.saveAs(zipPath);
 const entries=unzip(readFileSync(zipPath));
 check('浏览器整篇下载成功，ZIP包含按序四张PNG与完整中文文案',entries.length===5&&entries.slice(0,4).every((entry,i)=>entry.name===String(i+1).padStart(2,'0')+'.png'&&PNG.sync.read(entry.bytes).width===1080)&&entries[4].name==='文案.txt'&&entries[4].bytes.toString('utf8').includes(content.body));
 for(const [i,entry] of entries.slice(0,4).entries())writeFileSync(join(output,'实测卡片-'+(i+1)+'.png'),entry.bytes);
 await page.getByLabel('标题',{exact:true}).fill(content.title+'修改');
 await page.getByRole('button',{name:'下载整篇 PNG（ZIP）'}).click();
 await page.getByText('文字有未保存修改，请先保存文字。',{exact:true}).waitFor();
 check('有未保存文字时阻止下载旧图',true);
 await page.getByRole('button',{name:'保存文字',exact:true}).click();
 await page.getByText('文字已保存；图片预览已失效，请重新生成。',{exact:true}).waitFor();
 const changed=(await call('/api/accounts/a/data')).drafts[0];
 check('修改文字使旧预览与下载失效',changed.pngExport===null&&changed.media.length===0&&await page.getByRole('button',{name:'下载整篇 PNG（ZIP）'}).isDisabled());
 const stale=await fetch(base+'/api/accounts/a/drafts/'+draft.id+'/download');
 check('后端也拒绝已失效的下载',stale.status===409);
 for(const endpoint of ['/api/connections/a/open','/api/connections/canva/verify','/api/accounts/a/metrics/sync','/api/accounts/a/review-next','/api/accounts/a/drafts/'+draft.id+'/publish']){
   const response=await fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Content-OS':'1'},body:'{}'});
   check('后端已关闭：'+endpoint,response.status===423);
 }
 const styleIds=[draft.pngExport.styleId];
 for(let i=0;i<2;i++){
   const next=await call('/api/accounts/b/drafts',{topic:'MVP 卡通轮换隔离样本 '+i});
   await call('/api/accounts/b/drafts/'+next.id+'/content',{content});
   const rendered=await call('/api/accounts/b/drafts/'+next.id+'/render-png',{});
   styleIds.push(rendered.pngExport.styleId);
   copyFileSync(join(directory,'media',rendered.media[0].filename),join(output,rendered.pngExport.styleId+'.png'));
 }
 check('连续三篇真实本地出图使用三种不同卡通构图',new Set(styleIds).size===3);
 const tooLong=structuredClone(content);tooLong.cards[0].text='过长文字测试'.repeat(200);
 await call('/api/accounts/a/drafts/'+draft.id+'/content',{content:tooLong});
 const response=await fetch(base+'/api/accounts/a/drafts/'+draft.id+'/render-png',{method:'POST',headers:{'Content-Type':'application/json','X-Content-OS':'1'},body:'{}'});
 check('文字放不下时提示拆页，不保存不完整导出',response.status===422&&(await call('/api/accounts/a/data')).drafts[0].pngExport===null);
 const cross=await fetch(base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Content-OS':'1',Origin:'https://untrusted.example'},body:'{}'});
 check('动态端口下仍拒绝跨来源写入',cross.status===403);
 const control=JSON.parse(readFileSync(join(directory,'runtime-controls.json'),'utf8'));
 check('没有付费调用或外部平台请求',control.spentUpperBoundCny===0&&external.length===0);
 await page.goto(base+'/#settings');
 await page.getByText('预算保护使用的模型价格',{exact:true}).click();
 await page.getByLabel('输入价格（缓存未命中）').fill('2');
 await page.getByLabel('输出价格',{exact:true}).fill('8');
 await page.getByLabel('已核对上述价格，可用于接下来 24 小时的预算保护').check();
 await page.getByRole('button',{name:'保存设置',exact:true}).click();
 await page.getByText('设置已保存到本机；密钥不会返回浏览器。',{exact:true}).waitFor();
 const configured=await call('/api/state');
 check('用户可更新预算价格，保存设置仍保持付费暂停',configured.settings.pricing.input===2&&configured.settings.paidAiPaused===true);
 await page.setViewportSize({width:390,height:844});
 await page.goto(base+'/#overview');await page.getByRole('heading',{name:'把一篇图文做好。'}).waitFor();
 await page.screenshot({path:join(output,'MVP窄屏.png'),fullPage:true});
 check('窄屏页面无水平溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(errors.length)throw Error(errors.join('\n'));
 const report={at:new Date().toISOString(),kind:'隔离本地 MVP 验收，非真实运营闭环',checks,errors,externalRequests:external,paidAiCalls:0,realPublishCalls:0,styleIds,artifacts:zipPath};
 writeFileSync(join(output,'MVP验收结果.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:checks.length,errors,paidAiCalls:0,realPublishCalls:0,output}));
}catch(error){
 if(page){writeFileSync(join(output,'失败页面.txt'),await page.locator('body').innerText());await page.screenshot({path:join(output,'失败页面.png'),fullPage:true});}
 console.error(JSON.stringify({checks,errors,external,message:error.message}));throw error;
}finally{if(browser)await browser.close();child.kill();}

