import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pageCount, selectPage, verifyNativeDesign } from '../lib/canva.mjs';

let browser;
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });

test('可画旧版底部按钮仍按官方总页数读取，不能按可见画布计数', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<main><div role="application" aria-label="画布内容"><div role="group" aria-label="第1页">可见画布</div></div></main><footer><button><span>1/4</span></button></footer>');
    assert.equal(await pageCount(page), 4);
  } finally { await page.close(); }
});

test('缩略图模式重开核对实际可编辑文字，不能点击不可操作的可访问镜像', async () => {
  const page = await browser.newPage();
  try {
    const texts=['项目记录标题','实际正文文字','CONTENT OS · 01 / 01'];
    await page.setContent(`<input aria-label="设计名称"><div role="menuitem">已保存所有更改</div>
      <div role="application" aria-label="画布内容"><div role="group" aria-label="第1页" style="pointer-events:none">${texts.map(text=>'<p>'+text+'</p>').join('')}</div></div>
      <div aria-hidden="true">${texts.map(text=>'<p><span ondblclick="const box=document.querySelector(\'[role=textbox]\');box.hidden=false;box.textContent=this.textContent">'+text+'</span></p>').join('')}</div>
      <div role="textbox" aria-label="文字中的文字编辑器" contenteditable="true" hidden onkeydown="if(event.key==='Escape')this.hidden=true"></div>
      <nav aria-label="页码"><button aria-label="第 1 页">缩略图</button></nav><footer><button>页面</button><p>1/1</p></footer>`);
    // 保留真实浏览器的交互；只把重开替换为本地设计样本，避免联网。
    const url='https://www.canva.cn/design/LOCAL/TEXT-FIXTURE/edit';
    page.url=()=>url;
    page.reload=async()=>{};
    const checked=await verifyNativeDesign({context:async()=>({pages:()=>[page]})},{url,cardsCompleted:1,expectedTexts:texts});
    assert.equal(checked.verifiedEditable,true);
  } finally { await page.close(); }
});

test('可画新建画布使用普通页码和缩略图导航，只选择目标页', async () => {
  const page = await browser.newPage();
  try {
    // 复现实际新建画布：页码不是按钮，画布只渲染当前页。
    await page.setContent(`<main>
      <div role="application" aria-label="画布内容"><div role="group" aria-label="第1页">第一页</div></div>
      <nav aria-label="页码" hidden>
        <button aria-label="第 1 页">第一页缩略图</button>
        <button aria-label="第 3 页" onclick="document.querySelector('[role=group]').setAttribute('aria-label','第3页');document.querySelector('[role=group]').textContent='目标页中文';document.querySelector('[data-counter]').textContent='3/4'">第三页缩略图</button>
      </nav>
    </main><footer><button onclick="document.querySelector('nav').hidden=false">页面</button><p data-counter>1/4</p></footer>`);
    assert.equal(await pageCount(page), 4);
    const selected = await selectPage(page, 2);
    assert.equal(await selected.innerText(), '目标页中文');
    assert.equal(await page.getByRole('contentinfo').getByText('3/4', { exact: true }).innerText(), '3/4');
    assert.equal(await pageCount(page), 4);
    // 添加第二页后页码变成按钮，仍要沿用已展开的缩略图导航。
    await page.locator('[data-counter]').evaluate(element => { element.outerHTML='<button data-counter>3/4</button>'; });
    assert.equal(await (await selectPage(page, 2)).innerText(), '目标页中文');
  } finally { await page.close(); }
});
