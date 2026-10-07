import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { cartoonStyles } from '../public/cartoon-styles.js';

// 背景不含中文，文字由本地网页或可画文本框排版；保留已确认稿的旧风格。
export function cartoonStyleFor(id) {
  const style=cartoonStyles.find(item=>item.id===id);
  if(!style) throw Error('未知的卡通风格，请先核对本篇设计。');
  return {...style,source:'https://www.opendoodles.com/about',license:'CC0'};
}
export const cartoonStyle = cartoonStyleFor('cartoon-notebook-v1');

export function cartoonBackground(index,plan={styleId:cartoonStyle.id,variant:0}) {
  const style=cartoonStyleFor(plan.styleId);
  const variant=plan.variant||0;
  const names=['reading-side','sitting-reading','meditating'];
  const source=readFileSync(resolve(import.meta.dirname,'../assets/cartoon',names[(index+variant)%3]+'.svg'),'utf8');
  const accent=style.accents[(index+variant)%3];
  const illustration=source.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)[1].replaceAll('#FF5678',style.accents[(index+variant+1)%3]).replaceAll('#000000',style.outline);
  const star=(x,y,size=28)=>`<path d="M${x} ${y-size} Q${x+5} ${y-5} ${x+size} ${y} Q${x+5} ${y+5} ${x} ${y+size} Q${x-5} ${y+5} ${x-size} ${y} Q${x-5} ${y-5} ${x} ${y-size}Z" fill="#FFD87A" stroke="#2E3D3A" stroke-width="3"/>`;
  if(style.id==='cartoon-comic-v1') {
    const burst=Array.from({length:24},(_,i)=>{const radius=i%2?106:150;const angle=i*Math.PI/12;return `${800+Math.cos(angle)*radius},${1135+Math.sin(angle)*radius}`;}).join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
      <defs><pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2" fill="#B9D3E6"/></pattern></defs>
      <rect width="1080" height="1440" fill="${style.background}"/><rect width="1080" height="1440" fill="url(#dots)"/>
      <path d="M54 84 H1026 V292 H80 L54 266Z" fill="${style.outline}"/>
      <path d="M40 70 H1010 V280 H68 L40 252Z" fill="${accent}" stroke="${style.outline}" stroke-width="6"/>
      <path d="M50 352 H1010 V992 H240 L135 1035 L160 992 H50Z" fill="#FFFFFF" stroke="${style.outline}" stroke-width="6"/>
      <path d="M25 300 L70 320 M1020 309 L1055 281 M75 1050 L115 1080" stroke="${style.outline}" stroke-width="5"/>
      <svg x="55" y="1000" width="590" height="290" viewBox="0 0 1024 768">${illustration}</svg>
      <polygon points="${burst}" fill="${style.accents[(index+variant+1)%3]}" stroke="${style.outline}" stroke-width="5"/>
      <path d="M750 1090 Q800 1060 850 1090 M750 1140 H850 M770 1180 H830" fill="none" stroke="${style.outline}" stroke-width="7" stroke-linecap="round"/>
      <rect x="239" y="1298" width="602" height="88" rx="12" fill="#FFFFFF" stroke="${style.outline}" stroke-width="5"/>
      <path d="M45 1370 L190 1320 M887 1320 L1030 1370" fill="none" stroke="${style.outline}" stroke-width="4"/>
    </svg>`;
  }
  if(style.id==='cartoon-sticker-v1') return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
    <defs><pattern id="grid" width="45" height="45" patternUnits="userSpaceOnUse"><path d="M45 0 H0 V45" fill="none" stroke="#DCEDE0" stroke-width="1"/></pattern></defs>
    <rect width="1080" height="1440" fill="${style.background}"/><rect width="1080" height="1440" fill="url(#grid)"/>
    <rect x="40" y="70" width="1000" height="224" rx="112" fill="${accent}" stroke="${style.outline}" stroke-width="3"/>
    <rect x="69" y="366" width="950" height="640" rx="9" fill="#DCD2FF" transform="rotate(1 540 650)"/>
    <rect x="50" y="352" width="960" height="640" rx="9" fill="#FFFFFF" stroke="${style.outline}" stroke-width="3" transform="rotate(-.6 540 650)"/>
    <rect x="90" y="320" width="210" height="52" rx="5" fill="#FFE5A5" transform="rotate(-10 190 346)"/>
    <rect x="800" y="322" width="180" height="48" rx="5" fill="#BDEBCD" transform="rotate(8 890 346)"/>
    <g transform="translate(84 1070) rotate(-9)"><rect width="190" height="135" rx="13" fill="#DCD2FF" stroke="#FFFFFF" stroke-width="10"/><path d="M25 40 H155 M25 70 H135 M25 100 H110" stroke="${style.outline}" stroke-width="5"/></g>
    <circle cx="130" cy="1280" r="42" fill="#FFE5A5" stroke="#FFFFFF" stroke-width="9"/><path d="M112 1267 V1274 M148 1267 V1274 M110 1289 Q130 1306 150 1289" fill="none" stroke="${style.outline}" stroke-width="4" stroke-linecap="round"/>
    <svg x="320" y="993" width="630" height="297" viewBox="0 0 1024 768">${illustration}</svg>
    ${star(971,1042,32)}${star(938,40,21)}
    <rect x="239" y="1298" width="602" height="88" rx="16" fill="#FFFFFF" stroke="${style.outline}" stroke-width="3"/>
    <path d="M258 1373 H822" stroke="#DCD2FF" stroke-width="4" stroke-dasharray="12 7"/>
  </svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
  <rect width="1080" height="1440" fill="#FFF6E5"/>
  <path d="M0 1160 Q80 1100 160 1160 T320 1160 T480 1160 T640 1160 T800 1160 T960 1160 T1120 1160 V1440 H0Z" fill="#E5EFE7"/>
  <rect x="48" y="82" width="988" height="224" rx="40" fill="#2E3D3A" opacity=".12"/>
  <rect x="40" y="70" width="1000" height="224" rx="40" fill="${accent}" stroke="#2E3D3A" stroke-width="4"/>
  <path d="M85 313 Q125 325 165 309 M918 313 Q960 301 998 312" fill="none" stroke="#D49577" stroke-width="5" stroke-linecap="round"/>
  <rect x="60" y="366" width="960" height="640" rx="36" fill="#E3CDB0"/>
  <rect x="50" y="352" width="960" height="640" rx="36" fill="#FFFEFA" stroke="#2E3D3A" stroke-width="3"/>
  <rect x="119" y="330" width="170" height="46" rx="7" fill="#FFD6B8" opacity=".9" transform="rotate(-7 200 352)"/>
  <rect x="779" y="330" width="170" height="46" rx="7" fill="#D8D5F0" opacity=".9" transform="rotate(7 860 352)"/>
  <path d="M80 395 H97 M80 428 H97 M80 461 H97 M80 494 H97" stroke="#DDD1BC" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="550" cy="1251" rx="300" ry="34" fill="${accent}"/>
  <svg x="270" y="981" width="580" height="306" viewBox="0 0 1024 768">${illustration}</svg>
  ${star(96,1060,25)}${star(964,1180,33)}${star(995,43,22)}
  <path d="M119 1198 Q94 1165 120 1148 Q138 1134 152 1157 Q172 1134 190 1153 Q215 1180 153 1216Z" fill="#FFB7A1" stroke="#2E3D3A" stroke-width="3"/>
  <g transform="translate(850 1030) rotate(10)"><rect width="117" height="100" rx="12" fill="#C6E8DB" stroke="#2E3D3A" stroke-width="4"/><path d="M59 8 V90 M10 24 H44 M10 43 H44 M73 24 H103 M73 43 H103" fill="none" stroke="#2E3D3A" stroke-width="3" stroke-linecap="round"/></g>
  <rect x="239" y="1298" width="602" height="88" rx="30" fill="#FFFEFA" stroke="#2E3D3A" stroke-width="3"/>
  <circle cx="275" cy="1342" r="7" fill="#FFB7A1"/><circle cx="805" cy="1342" r="7" fill="#C6E8DB"/>
  <path d="M26 30 V1412 H1053 V30" fill="none" stroke="#D4C5AB" stroke-width="2" stroke-dasharray="5 10"/>
  </svg>`;
}

export function writeCartoonBackgrounds(directory,count,plan={styleId:cartoonStyle.id,variant:0}) {
  mkdirSync(directory,{recursive:true});
  return Array.from({length:count},(_,index)=>{
    const path=join(directory,`${plan.styleId}-variant-${plan.variant||0}-${index+1}.svg`);
    writeFileSync(path,cartoonBackground(index,plan));
    return path;
  });
}

export async function renderCartoonBackgrounds(directory,count,plan={styleId:cartoonStyle.id,variant:0}) {
  const paths=writeCartoonBackgrounds(directory,count,plan);
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
  try {
    const page=await browser.newPage({viewport:{width:1080,height:1440},deviceScaleFactor:1});
    const images=[];
    for(const path of paths) {
      await page.setContent(`<style>html,body{margin:0;width:1080px;height:1440px;overflow:hidden}</style>${readFileSync(path,'utf8')}`);
      const image=path.replace(/\.svg$/,'.png');
      await page.screenshot({path:image,timeout:20000});
      images.push(image);
    }
    return images;
  } finally {await browser.close();}
}

export function hasCartoonPalette(bytes,styleId=cartoonStyle.id) {
  const style=cartoonStyleFor(styleId);
  const rgb=hex=>[1,3,5].map(position=>parseInt(hex.slice(position,position+2),16));
  const base=rgb(style.background),colors=style.accents.map(rgb);
  const png=PNG.sync.read(bytes);
  let background=0,accent=0;
  for(let i=0;i<png.data.length;i+=4) {
    const r=png.data[i],g=png.data[i+1],b=png.data[i+2];
    if(Math.abs(r-base[0])<4&&Math.abs(g-base[1])<4&&Math.abs(b-base[2])<4) background++;
    for(const color of colors) if(Math.abs(r-color[0])<4&&Math.abs(g-color[1])<4&&Math.abs(b-color[2])<4) {accent++;break;}
  }
  // 只核对本篇配色是否进入图片，不把像素检查冒充审美或点击率验证。
  return background>10000&&accent>10000;
}
