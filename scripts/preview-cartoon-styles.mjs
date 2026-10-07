// 本地样式示意，不是可画导出，不进入运营稿或发布媒体目录。
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { cartoonStyles } from '../public/cartoon-styles.js';
import { cartoonBackground } from '../lib/cartoon.mjs';

const directory=resolve('output/review/style-previews');
mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
const previews=[];
try {
  const page=await browser.newPage({viewport:{width:1080,height:1440},deviceScaleFactor:1});
  for(const style of cartoonStyles) {
    await page.setContent(`<style>
      html,body{margin:0;width:1080px;height:1440px;overflow:hidden;font-family:"Microsoft YaHei",sans-serif;color:#18232c}
      .title,.body,.footer{position:absolute;left:90px;width:900px;text-align:center;white-space:pre-line}
      .title{top:130px;font-size:64px;font-weight:700;line-height:1.4}
      .body{top:420px;font-size:45px;line-height:1.4}
      .footer{top:1320px;font-size:32px}
    </style>${cartoonBackground(0,{styleId:style.id,variant:0})}
    <div class="title">${style.name}</div>
    <div class="body">新稿自动换一种卡通构图。\n同一篇的多页保持一致。\n\n配色、纸卡、装饰和插画安排\n随本篇风格变化。\n\n这是本地样式示意，\n还不是可画真实导出。</div>
    <div class="footer">样式本地预览 · 不用于发布</div>`);
    const path=resolve(directory,style.id+'.png');
    await page.screenshot({path});
    previews.push({styleId:style.id,name:style.name,path});
  }
} finally {await browser.close();}
writeFileSync(resolve(directory,'manifest.json'),JSON.stringify({kind:'本地样式示意，非可画导出',at:new Date().toISOString(),previews},null,2));
console.log(JSON.stringify(previews));
