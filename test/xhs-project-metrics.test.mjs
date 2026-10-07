import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../lib/store.mjs';
import { syncXhsMetrics } from '../lib/xiaohongshu.mjs';

function fixture(rows) {
  const store=new Store(':memory:');
  store.put('accounts',{...store.requireAccount('a'),platformIdentity:'ACCOUNT_A'});
  const draft=store.createDraft('a',{topic:'本项目测试稿'});
  store.put('drafts',{...draft,state:'published',noteId:'new123'});
  const page=(url,text)=>({url:()=>url,reload:async()=>{},waitForFunction:async()=>{},getByText:()=>({first:()=>({waitFor:async()=>{}})}),locator:selector=>selector==='body'?{innerText:async()=>text}:{evaluateAll:async()=>rows}});
  const pages=[page('https://creator.xiaohongshu.com/new/home','小红书账号: ACCOUNT_A'),page('https://creator.xiaohongshu.com/statistics/data-analysis','笔记数据')];
  const browsers={context:async()=>({pages:()=>pages}),capture:async()=>{}};
  return {store,browsers};
}

test('官方表格包含旧笔记时只保存本项目本账号已发布稿的指标',async()=>{
  const row=(id,value)=>({href:'https://www.xiaohongshu.com/explore/'+id,title:id,headers:['阅读量','点赞'],cells:[value,'—']});
  const f=fixture([row('old123','18'),row('new123','0'),row('otherAccount','100')]);
  try {
    assert.equal((await syncXhsMetrics(f.browsers,f.store,'a')).count,1);
    const metrics=f.store.list('metrics','a');
    assert.equal(metrics[0].noteId,'new123');
    assert.equal(metrics[0].values.views,0);
    assert.equal(metrics[0].values.likes,null);
  } finally {f.store.close();}
});

test('只有旧笔记数据时不保存快照，不能冒充本项目反馈',async()=>{
  const f=fixture([{href:'https://www.xiaohongshu.com/explore/old123',title:'旧笔记',headers:['阅读量'],cells:['18']}]);
  try {
    await assert.rejects(syncXhsMetrics(f.browsers,f.store,'a'),/旧笔记不计入/);
    assert.equal(f.store.list('metrics','a').length,0);
  } finally {f.store.close();}
});
