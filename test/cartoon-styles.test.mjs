import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { Store } from '../lib/store.mjs';
import { cartoonStyles } from '../public/cartoon-styles.js';
import { cartoonBackground, renderCartoonBackgrounds, hasCartoonPalette } from '../lib/cartoon.mjs';

test('新稿按篇轮换三套卡通构图，同篇续写或改文字保留所选风格',()=>{
  const store=new Store(':memory:');
  try {
    const old=store.createDraft('a',{topic:'旧版手帐稿'});
    store.put('drafts',{...old,design:{style:{id:'cartoon-notebook-v1'},verifiedAt:'2026-10-01T00:00:00Z'}});
    const selected=[];
    for(const accountId of ['a','b','a']) {
      const draft=store.createDraft(accountId,{topic:'新稿风格测试'});
      const plan=store.planCartoonDesign(draft);
      selected.push(plan.styleId);
      assert.ok(plan.variant>=0&&plan.variant<3);
      assert.deepEqual(store.planCartoonDesign(store.requireDraft(accountId,draft.id)),plan);
      store.saveContent(accountId,draft.id,{title:'本地测试',body:'本地文字',tags:[],cards:[{heading:'标题',text:'正文'}]});
      assert.deepEqual(store.planCartoonDesign(store.requireDraft(accountId,draft.id)),plan);
    }
    assert.deepEqual(selected,['cartoon-comic-v1','cartoon-sticker-v1','cartoon-notebook-v1']);
  } finally {store.close();}
});

test('确认接受三套已知卡通风格，仍阻止未知风格和变更的图片',()=>{
  const store=new Store(':memory:');
  try {
    for(const style of cartoonStyles) {
      const draft={content:{cards:[{}]},design:{style:{id:style.id,appliedPages:1,verifiedMediaHashes:['已核对']}},media:[{sha256:'已核对'}]};
      assert.doesNotThrow(()=>store.requireCartoonDesign(draft));
      assert.throws(()=>store.requireCartoonDesign({...draft,media:[{sha256:'替换图'}]}),/旧图片/);
      assert.throws(()=>store.requireCartoonDesign({...draft,design:{style:{...draft.design.style,id:'自称卡通的未知风格'}}}),/卡通风格/);
    }
  } finally {store.close();}
});

test('三套构图不同，同套不同稿件可改变配色和插画顺序',()=>{
  const images=cartoonStyles.map(style=>cartoonBackground(0,{styleId:style.id,variant:0}));
  assert.equal(new Set(images).size,3);
  for(const style of cartoonStyles) {
    const first=cartoonBackground(0,{styleId:style.id,variant:0});
    assert.ok(first.includes('width="1080" height="1440"'));
    assert.notEqual(first,cartoonBackground(0,{styleId:style.id,variant:1}));
  }
});

test('三套本地背景实际渲染为PNG，配色校验绑定本篇风格',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'content-os-style-'));
  try {
    for(const [index,style] of cartoonStyles.entries()) {
      const [image]=await renderCartoonBackgrounds(directory,1,{styleId:style.id,variant:0});
      const bytes=readFileSync(image);
      assert.equal(hasCartoonPalette(bytes,style.id),true);
      assert.equal(hasCartoonPalette(bytes,cartoonStyles[(index+1)%3].id),false);
    }
  } finally {
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('content-os-style-'));
    rmSync(directory,{recursive:true});
  }
});
