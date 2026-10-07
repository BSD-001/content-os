import { fail } from './store.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join,basename } from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { cartoonStyle,cartoonStyleFor,renderCartoonBackgrounds,hasCartoonPalette } from './cartoon.mjs';
import { isCartoonStyle } from '../public/cartoon-styles.js';

export async function openDesign(browsers, url) {
  if (!/^https:\/\/www\.canva\.cn\/design\/[^/]+\/[^/]+\/edit$/.test(url)) throw fail('可画编辑链接格式不正确。');
  const context = await browsers.context('canva');
  let page = context.pages().find(p => p.url().split('?')[0] === url);
  if (!page) { page = await context.newPage(); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
  await page.getByLabel('设计名称', { exact: true }).waitFor({ timeout: 30000 });
  return page;
}
async function saved(page) {
  await page.getByRole('menuitem', { name: '已保存所有更改', exact: true }).waitFor({ timeout: 30000 });
}
async function position(page, values) {
  if (!await page.getByLabel('宽度', { exact: true }).isVisible()) await page.getByRole('button', { name: '调整图层', exact: true }).click();
  for (const [label, value] of Object.entries(values)) {
    const input = page.getByLabel(label, { exact: true });
    await input.click();
    await input.press('Control+A');
    await input.pressSequentially(String(value));
    await input.press('Enter');
    await input.press('Tab');
    await page.waitForTimeout(500);
    // 位置面板异步提交，读回数值后才操作下一个字段。
    await page.waitForFunction(({label,value}) => [...document.querySelectorAll('input')].some(el => [...(el.labels || [])].some(l => l.textContent === label) && Math.abs(parseFloat(el.value) - value) < 1), { label, value }, { timeout: 5000 });
  }
}
export async function pageCount(page) {
  // 页面画布会按滚动位置局部渲染，总数以官方底部页码为准。
  const counter=await page.getByRole('contentinfo').getByText(/^\d+\s*\/\s*\d+$/).innerText();
  return Number(counter.split('/')[1].trim());
}
export async function selectPage(page,index) {
  const counter=page.getByRole('button',{name:/^\d+\s*\/\s*\d+$/});
  const navigation=page.getByRole('navigation',{name:'页码',exact:true});
  if(await navigation.count()||!await counter.count()) {
    // 新建画布的页码是普通文字，使用官方页面缩略图导航。
    if(!await navigation.isVisible()) await page.getByRole('contentinfo').getByRole('button',{name:'页面',exact:true}).click();
    await navigation.getByRole('button',{name:`第 ${index+1} 页`,exact:true}).click();
    const sheet=page.getByRole('application',{name:'画布内容',exact:true}).getByRole('group',{name:`第${index+1}页`,exact:true});
    await sheet.waitFor();
    return sheet;
  }
  await counter.click();
  const input=page.getByLabel('转至页面',{exact:true});
  await input.fill(String(index+1));
  await input.press('Enter');
  const controls=page.getByRole('group',{name:'页面控制',exact:true}).filter({hasText:new RegExp(`^第\\s*${index+1}\\s*页`)});
  if(index===0&&await pageCount(page)===1) return page;
  await controls.waitFor();
  const sheet=controls.locator('..').locator('..');
  await sheet.click({position:{x:15,y:150}});
  return sheet;
}
export async function addText(page, text, heading, size, y, pageIndex=0) {
  const scope=await selectPage(page,pageIndex);
  const add = page.getByRole('button', { name: heading ? '添加标题' : '添加正文', exact: true });
  if (!await add.isVisible()) await page.getByRole('tab', { name: '文字', exact: true }).click();
  await add.click();
  const textbox = page.getByRole('textbox', { name: '文字中的文字编辑器', exact: true });
  // 收紧正文空行作为排版间距，不改文字或段落顺序。
  await textbox.fill(heading?text:text.replace(/\n{2,}/g,'\n'));
  await textbox.press('Escape');
  let fits=false;
  for(const candidate of [size,...[32,28].filter(value=>value<size)]) {
    const font=page.getByRole('combobox',{name:'字体大小',exact:true});
    if(!await font.isVisible()) {
      // 位置面板提交后可能选中整页；缩字号前重新选择该原生文本框。
      const textScope=await page.getByRole('navigation',{name:'页码',exact:true}).count()?page.locator('[aria-hidden="true"]'):scope;
      await textScope.getByText(text.split('\n')[0].slice(0,8),{exact:false}).filter({visible:true}).first().dblclick({force:true});
      await textbox.press('Escape');
    }
    await font.click();
    await font.fill(String(candidate));
    await font.press('Enter');
    await page.waitForTimeout(500);
    await position(page,{'宽度':900,X:90,Y:y});
    const bottom=y+parseFloat(await page.getByLabel('高度',{exact:true}).inputValue());
    const limit=heading?290:y>=1300?1380:972;
    if(bottom<=limit) {fits=true;break;}
  }
  if(!fits) throw fail('卡片文字超出可读版面；请缩短该页文字并重新确认，已有设计已保留。',409);
  await page.keyboard.press('Escape');
  await saved(page);
}
async function newCanvas(browsers, title) {
  const context = await browsers.context('canva');
  const home = await context.newPage();
  await home.goto('https://www.canva.cn/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await home.getByRole('button', { name: '创建设计', exact: true }).click();
  const dialog = home.getByRole('dialog');
  await dialog.getByRole('button', { name: '自定义大小', exact: true }).click();
  await dialog.getByLabel('宽度', { exact: true }).fill('1080');
  await dialog.getByLabel('高度', { exact: true }).fill('1440');
  const opened = context.waitForEvent('page', { timeout: 30000 });
  await dialog.getByRole('button', { name: '在新标签或窗口中创建设计', exact: true }).click();
  const page = await opened;
  await page.waitForURL(/canva\.cn\/design\/[^/]+\/[^/]+\/edit/, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.getByLabel('设计名称', { exact: true }).fill(title);
  await page.getByLabel('设计名称', { exact: true }).press('Enter');
  await home.close();
  return page;
}
export async function createNativeDesign(browsers, content, title, onProgress, existingDesign=null,visualPlan=null) {
  if (content.cards.some(c => c.heading.length > 32 || c.text.length > 280)) throw fail('请先把每页标题控制在 32 字以内、正文控制在 280 字以内，确认修改后再排版。');
  if(existingDesign?.cardsCompleted) await verifyNativeDesign(browsers,existingDesign,true);
  const page = existingDesign?await openDesign(browsers,existingDesign.url):await newCanvas(browsers, title);
  if(existingDesign&&!existingDesign.cardsCompleted&&(await pageCount(page)!==1||(await page.getByRole('application',{name:'画布内容',exact:true}).innerText()).trim())) throw fail('现有设计尚无完整页记录，但画布已有内容；请先核对，不重复添加文字。',409);
  let design = existingDesign||{ url: page.url().split('?')[0], title, method: 'official_web_native', verifiedEditable: false, cardsCompleted: 0, expectedTexts: [] };
  design={...design,visualPlan:design.visualPlan||visualPlan||{styleId:design.style?.id||cartoonStyle.id,variant:0}};
  await onProgress(design);
  for (const [index, card] of [...content.cards.entries()].slice(design.cardsCompleted)) {
    if (index) {
      const count=await pageCount(page);
      if(count!==index&&count!==index+1) throw fail('现有设计页数与制作进度不一致，请先核对。',409);
      // 失败前已添加且核对为空白的末页直接续写，不重复添加。
      if(count===index) {
      await selectPage(page,index-1);
      const controls=page.getByRole('group',{name:'页面控制',exact:true}).filter({hasText:new RegExp(`^第\\s*${index}\\s*页`)});
      const navigation=page.getByRole('navigation',{name:'页码',exact:true});
      const add=await navigation.isVisible()?navigation.getByRole('button',{name:'添加页面',exact:true}):await controls.count()?controls.getByRole('button',{name:'添加页面',exact:true}):page.getByRole('button',{name:'添加页面',exact:true}).filter({hasText:'添加页面'});
      await add.click();
      await page.getByRole('contentinfo').getByText(new RegExp(`^\\d+\\s*/\\s*${index+1}$`)).waitFor({timeout:15000});
      }
    }
    await addText(page, card.heading, true, 48, 130, index);
    await addText(page, card.text, false, 34, 420, index);
    const footer = `CONTENT OS · ${String(index + 1).padStart(2, '0')} / ${String(content.cards.length).padStart(2, '0')}`;
    await addText(page, footer, false, 24, 1320, index);
    design = { ...design, cardsCompleted: index + 1, expectedTexts: [...design.expectedTexts, card.heading, card.text, footer] };
    await onProgress(design);
  }
  const checked=await verifyNativeDesign(browsers, design);
  return applyCartoonStyle(browsers,checked,join(browsers.dataDir,'design-backgrounds'),onProgress);
}
export async function applyCartoonStyle(browsers,design,directory,onProgress) {
  const plan=design.visualPlan||{styleId:design.style?.id||cartoonStyle.id,variant:0};
  const selected=cartoonStyleFor(plan.styleId);
  const images=await renderCartoonBackgrounds(directory,design.cardsCompleted,plan);
  let current={...design,visualPlan:plan,style:{...selected,variant:plan.variant,appliedPages:design.style?.id===selected.id?design.style.appliedPages||0:0,verifiedMediaHashes:[]}};
  for(let index=current.style.appliedPages;index<images.length;index++) {
    const page=await openDesign(browsers,current.url);
    await selectPage(page,index);
    await page.getByRole('tab',{name:'上传',exact:true}).click();
    await page.locator('input[type=file]').setInputFiles(images[index]);
    const asset=page.getByRole('button',{name:basename(images[index]),exact:true}).first();
    await asset.waitFor({timeout:30000});
    await asset.click();
    await position(page,{'宽度':1080,'高度':1440,X:0,Y:0});
    const back=page.getByRole('button',{name:'移至最后',exact:true});
    if(!await back.isDisabled()) await back.click();
    await page.keyboard.press('Escape');
    await saved(page);
    current={...current,style:{...current.style,appliedPages:index+1}};
    await onProgress(current);
  }
  return verifyNativeDesign(browsers,current);
}
export async function verifyNativeDesign(browsers, design,allowEmptyTrailingPage=false) {
  const page=await openDesign(browsers,design.url);
  await saved(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await saved(page);
  // 可画手动增删页面后必须先核对，避免漏导出或把页码对应到错误内容。
  const count=await pageCount(page);
  if(allowEmptyTrailingPage&&count===design.cardsCompleted+1) {
    const trailing=await selectPage(page,design.cardsCompleted);
    if((await trailing.innerText()).trim()) throw fail('未完成末页已有内容，请先核对，不重复添加文字。',409);
  } else if(count!==design.cardsCompleted) throw fail('可画页数或文字记录与已确认稿件不一致，请先核对已有设计。',409);
  if(design.expectedTexts.length!==design.cardsCompleted*3) throw fail('可画文字记录与已确认稿件不一致，请先核对已有设计。',409);
  // 从原生画布重新进入文本框核对，不能用整张图片代替可编辑性。
  for (const [index,text] of design.expectedTexts.entries()) {
    const pageIndex=Math.floor(index/3);
    const scope=await selectPage(page,pageIndex);
    // 缩略图模式的可访问文本镜像不接收点击；选择当前画布的实际绘制文字。
    const textScope=await page.getByRole('navigation',{name:'页码',exact:true}).count()?page.locator('[aria-hidden="true"]'):scope;
    const target = textScope.getByText(text.split('\n')[0].slice(0,8), { exact: false }).filter({ visible: true }).first();
    await target.dblclick({force:true});
    const textbox = page.getByRole('textbox', { name: '文字中的文字编辑器', exact: true });
    if ((await textbox.innerText()).replace(/\s+/g,' ').trim() !== text.replace(/\s+/g,' ').trim()) throw fail(`第 ${pageIndex+1} 页的文字核对不一致：目标「${text.slice(0,15)}」，实际选中「${(await textbox.innerText()).slice(0,30)}」。`, 409);
    await textbox.press('Escape');
  }
  return { ...design, verifiedEditable: true, verifiedAt: new Date().toISOString() };
}
export async function exportNativeDesign(browsers, design, directory, prefix) {
  mkdirSync(directory, { recursive: true });
  const media = [];
  for (let index=0;index<design.cardsCompleted;index++) {
  const page = await openDesign(browsers, design.url);
  await saved(page);
  await page.getByRole('menuitem', { name: '导出', exact: true }).click();
  await page.getByRole('button', { name: '下载', exact: true }).click();
  const type = page.getByRole('combobox', { name: '文件类型', exact: true });
  await type.waitFor();
  if (!(await type.innerText()).includes('PNG')) throw fail('请将可画下载文件类型设为 PNG 后重试。', 409);
  if (design.cardsCompleted > 1) {
    await page.getByRole('radio',{name:'自定义',exact:true}).click();
    const range=page.getByLabel('自定义页面范围',{exact:true});
    await range.fill(String(index+1));
    await range.press('Tab');
  }
  const downloading = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: '下载', exact: true }).click();
  const download = await downloading;
  const filename = `${prefix}-${Date.now()}-${index + 1}.png`;
  const source = join(directory, filename);
  let downloadTimer;
  try {
    await Promise.race([download.saveAs(source),new Promise((_,reject)=>{downloadTimer=setTimeout(()=>reject(new Error('官网下载未返回完成状态')),30000);})]);
  }
  catch (error) {
    await download.cancel().catch(()=>{});
    // 浏览器关闭或下载未返回完成状态时，接收本次官网下载事件给出的同一份文件。
    const link = new URL(download.url());
    if (link.protocol !== 'https:' || link.hostname !== 'export-download.canva.cn') throw fail('官网下载中断，当前文件链接不能确认来自国内可画。',409);
    const response = await fetch(link.href, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw fail('可画导出文件链接已经失效，请重新导出。',409);
    writeFileSync(source, Buffer.from(await response.arrayBuffer()));
  }
  finally {clearTimeout(downloadTimer);}
  const bytes = readFileSync(source);
    const {width,height}=validatePng(bytes);
    if(isCartoonStyle(design.style?.id)&&!hasCartoonPalette(bytes,design.style.id)) throw fail('导出图未检测到本篇卡通底色，请检查该页背景；不能确认发布。',409);
    media.push({ filename, width, height, sha256: createHash('sha256').update(bytes).digest('hex') });
    if (!page.isClosed()) await page.keyboard.press('Escape');
  }
  return media;
}

export function validatePng(bytes) {
  let png;
  try { png=PNG.sync.read(bytes); } catch { throw fail('导出文件不是可读取的 PNG。',409); }
  if(png.width!==1080||png.height!==1440) throw fail('导出图片不是 1080×1440，请检查下载尺寸。',409);
  let ink=0;
  for(let i=0;i<png.data.length;i+=4) if(png.data[i+3]>0&&Math.min(png.data[i],png.data[i+1],png.data[i+2])<240) ink++;
  if(ink<500) throw fail('导出图片几乎为空白，请检查该页画布；暂不能确认发布。',409);
  // 非空白检查不能替代中文、排版和最终内容的逐图预览。
  return {width:png.width,height:png.height};
}
export async function verifyCanva(browsers, store) {
  const previous=store.get('connections','canva');
  const design=previous?.nativeProbe;
  if(!design?.url||design.cardsCompleted!==2) throw fail('尚无完整双页连接样本，请先在允许平台写入时创建并核对样本。',409);
  const checked=await verifyNativeDesign(browsers,design);
  const media=await exportNativeDesign(browsers,checked,join(browsers.dataDir,'probes'),'canva-native-two-pages');
  store.recordEvidence({connection:'canva',kind:'双页原生文字重开核对及实际PNG导出',status:'passed',media});
  return store.put('connections',{...previous,status:'verified',nativeProbe:{...checked,media},message:'连接样本的双页原生中文与导出已验证；实际运营稿件仍须逐图确认。',capabilities:{create:true,editableChinese:true,savedReopened:true,export:true,multiPage:true}});
}
