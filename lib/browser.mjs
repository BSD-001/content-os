import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fail } from './store.mjs';
import { verifyCanva } from './canva.mjs';
import { verifyXhs, syncXhsMetrics } from './xiaohongshu.mjs';

export const sites = { canva: 'https://www.canva.cn/', a: 'https://creator.xiaohongshu.com/', b: 'https://creator.xiaohongshu.com/' };

export class Browsers {
  constructor(dataDir, store) { this.dataDir = dataDir; this.store = store; this.contexts = new Map(); }
  async context(id) {
    if (id !== 'canva') this.store.requireAccount(id);
    if (this.contexts.has(id)) return this.contexts.get(id);
    const dir = join(this.dataDir, 'profiles', id);
    mkdirSync(dir, { recursive: true });
    let context;
    try { context = await chromium.launchPersistentContext(dir, { channel: 'msedge', headless: false, acceptDownloads: true, downloadsPath: join(dir,'downloads'), viewport: { width: 1366, height: 900 } }); }
    catch { throw fail('无法打开本地 Edge，请关闭占用该连接的窗口后重试。', 502); }
    this.contexts.set(id, context);
    context.on('close', () => this.contexts.delete(id));
    return context;
  }
  async page(id) {
    const context = await this.context(id);
    return context.pages().find(p => p.url().includes(id === 'canva' ? 'canva.cn' : 'xiaohongshu.com')) || context.pages()[0] || await context.newPage();
  }
  async open(id) {
    const page = await this.page(id);
    if (!page.url().includes(id === 'canva' ? 'canva.cn' : 'xiaohongshu.com')) await page.goto(id === 'canva' ? sites.canva : sites.a, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.bringToFront();
    return { message: '已打开连接窗口，请亲自完成登录及验证码。' };
  }
  async inspect(id) {
    const page = await this.page(id);
    return { url: page.url().split('?')[0], title: await page.title(), text: (await page.locator('body').innerText()).slice(0, 18000), elements: await page.locator('button,a,input,textarea,[role="button"]').evaluateAll(els => els.filter(el => el.getClientRects().length).slice(0, 140).map(el => ({ tag: el.tagName, role: el.getAttribute('role'), label: el.getAttribute('aria-label'), text: el.textContent?.trim().slice(0, 100), href: el.getAttribute('href'), placeholder: el.getAttribute('placeholder'), type: el.getAttribute('type') }))) };
  }
  async capture(id, label, targetPage) {
    const dir = join(this.dataDir, 'evidence');
    mkdirSync(dir, { recursive: true });
    const filename = `${id}-${Date.now()}.png`;
    const page = targetPage || await this.page(id);
    await page.screenshot({ path: join(dir, filename), fullPage: false });
    return this.store.recordEvidence({ connection: id, kind: label, filename, page: page.url().split('?')[0], status: 'observed' });
  }
  async verify(id) { return id==='canva'?verifyCanva(this,this.store):verifyXhs(this,this.store,id); }
  async syncMetrics(id) { return syncXhsMetrics(this,this.store,id); }
  async search(query) {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.locator('#b_results').waitFor({ timeout: 15000 });
      const items = await page.locator('#b_results li.b_algo h2 a').evaluateAll(els => els.slice(0, 5).map(el => ({ title: el.textContent, url: el.href })));
      for (const item of items) {
        // 必应跳转链接还原为原始来源链接，保留可核查的引用。
        const url = new URL(item.url);
        const encoded = url.searchParams.get('u');
        if (encoded?.startsWith('a1')) item.url = Buffer.from(encoded.slice(2), 'base64').toString('utf8');
        item.text = '';
        try {
          const target = new URL(item.url);
          if (!['http:', 'https:'].includes(target.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(target.hostname)) continue;
          const source = await browser.newPage();
          await source.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 12000 });
          item.text = (await source.locator('body').innerText()).slice(0, 9000);
          await source.close();
        } catch { item.error = '正文无法自动读取，保留搜索结果链接。'; }
      }
      return items;
    } catch { throw fail('资料检索失败，请检查网络；不会编造搜索结果。', 502); }
    finally { await browser.close(); }
  }
  async close() { for (const context of this.contexts.values()) await context.close(); }
}
