import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { PNG } from 'pngjs';
import { DeepSeek } from '../lib/ai.mjs';
import { validatePng,verifyNativeDesign } from '../lib/canva.mjs';
import { requireMediaFiles } from '../lib/media.mjs';
import { parseMetricsRows,verifyUploadedImages } from '../lib/xiaohongshu.mjs';

const fixture=(overrides={})=>{
  let control={testBudgetCny:5,baselineCny:10,spentUpperBoundCny:0,pricing:{'deepseek-flash':{input:2,output:8}},pricingCheckedAt:new Date().toISOString(),...overrides};
  let paidCalls=0;
  const provider=new DeepSeek(()=>({deepseekKey:'离线测试占位，不会发送',model:'deepseek-flash'}),()=>control,value=>control=value);
  provider.request=async path=>{
    if(path==='/user/balance') return {balance_infos:[{currency:'CNY',total_balance:String(10-(overrides.spentUpperBoundCny||0))}]};
    assert.equal(path,'/chat/completions');
    paidCalls++;
    return {choices:[{message:{content:'{"summary":"离线审稿样本"}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:3500}};
  };
  return {provider,control:()=>control,paidCalls:()=>paidCalls};
};
test('付费暂停时在任何模型请求前停止',async()=>{
  const f=fixture({paidAiPaused:true});
  await assert.rejects(f.provider.json('reviewer',{}),/暂停/);
  assert.equal(f.paidCalls(),0);
});
test('预算不足时不发送模型请求',async()=>{
  const f=fixture({spentUpperBoundCny:4.99});
  await assert.rejects(f.provider.json('reviewer',{}),/超出/);
  assert.equal(f.paidCalls(),0);
});
test('并行请求串行核对总预算，第二笔不能超支',async()=>{
  const f=fixture({spentUpperBoundCny:4.94});
  const results=await Promise.allSettled([f.provider.json('reviewer',{}),f.provider.json('reviewer',{})]);
  assert.equal(results[0].status,'fulfilled');
  assert.equal(results[1].status,'rejected');
  assert.equal(f.paidCalls(),1);
  assert.ok(f.control().spentUpperBoundCny<=5);
});
test('网络中断保留费用占用，不视作免费调用',async()=>{
  const f=fixture();
  const normal=f.provider.request;
  f.provider.request=async path=>{if(path==='/chat/completions') throw Error('离线模拟网络中断');return normal(path);};
  await assert.rejects(f.provider.json('reviewer',{}),/中断/);
  assert.ok(f.control().spentUpperBoundCny>0);
});
test('未收录价格的模型停止在付费请求之前',async()=>{
  const f=fixture({pricing:{}});
  await assert.rejects(f.provider.json('reviewer',{}),/价格尚未核对/);
  assert.equal(f.paidCalls(),0);
});
test('价格记录过期后不执行付费调用',async()=>{
  const f=fixture({pricingCheckedAt:'2020-01-01T00:00:00Z'});
  await assert.rejects(f.provider.json('reviewer',{}),/超过一天/);
  assert.equal(f.paidCalls(),0);
});
test('模型格式错误仍记录已产生的费用上界',async()=>{
  const f=fixture();
  const normal=f.provider.request;
  f.provider.request=async path=>{const result=await normal(path);if(path==='/chat/completions') result.choices[0].message.content='不完整 JSON';return result;};
  await assert.rejects(f.provider.json('reviewer',{}),/格式无法读取/);
  assert.equal(f.paidCalls(),1);
  assert.ok(f.control().spentUpperBoundCny>0);
});
test('真实尺寸的空白 PNG 不能进入最终确认',()=>{
  const image=new PNG({width:1080,height:1440});image.data.fill(255);
  assert.throws(()=>validatePng(PNG.sync.write(image)),/空白/);
});
test('可画手动增加页面后不能沿用原页数核验导出',async()=>{
  const url='https://www.canva.cn/design/LOCAL/FIXTURE/edit';
  // 实际六页只渲染三页，核验必须采用官方总页码，不能数当前画布。
  const page={url:()=>url,getByLabel:()=>({waitFor:async()=>{}}),reload:async()=>{},getByRole:(role)=>role==='contentinfo'?{getByText:()=>({innerText:async()=>'1/6'})}:role==='button'?{innerText:async()=>'1/6',count:async()=>3}:{waitFor:async()=>{}}};
  const browsers={context:async()=>({pages:()=>[page]})};
  await assert.rejects(verifyNativeDesign(browsers,{url,cardsCompleted:5,expectedTexts:Array(15).fill('离线核对样本')}),/页数/);
});
test('元数据未变化但本地图片被替换时停止上传',()=>{
  const directory=mkdtempSync(join(tmpdir(),'content-os-media-'));
  try {
    writeFileSync(join(directory,'image.png'),'已被替换的本地文件');
    assert.throws(()=>requireMediaFiles({media:[{filename:'image.png',sha256:'原图校验值'}]},directory),/图片文件已经变化/);
  } finally {
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('content-os-media-'));
    rmSync(directory,{recursive:true});
  }
});
test('图片文件丢失时停止上传',()=>{
  assert.throws(()=>requireMediaFiles({media:[{filename:'不存在.png',sha256:'校验值'}]},tmpdir()),/文件名不正确/);
  assert.throws(()=>requireMediaFiles({media:[{filename:'content-os-missing-image.png',sha256:'校验值'}]},tmpdir()),/文件缺失/);
});
test('明确表头的真实零值和缺失值分开解析',()=>{
  const items=parseMetricsRows([{href:'https://www.xiaohongshu.com/explore/abc123',title:'笔记',headers:['阅读量','点赞','曝光量'],cells:['0','2','—']}]);
  assert.equal(items[0].values.views,0);
  assert.equal(items[0].values.likes,2);
  assert.equal(items[0].values.impressions,null);
});
test('无指标名称或无笔记标识的数字不生成指标记录',()=>{
  assert.deepEqual(parseMetricsRows([{href:'https://www.xiaohongshu.com/explore/abc123',headers:[],cells:['18','1','3','1','1']}]),[]);
  assert.deepEqual(parseMetricsRows([{href:'https://creator.xiaohongshu.com/new/home',headers:['阅读量'],cells:['18']}]),[]);
});
test('平台预览顺序发生交换时停止在点击发布之前',async()=>{
  const files=[{buffer:Buffer.from('离线图一')},{buffer:Buffer.from('离线图二')}];
  const page={evaluate:async()=>({count:2,differences:[[12,0],[0,12]]})};
  await assert.rejects(verifyUploadedImages(page,files),/内容或顺序/);
});
test('缺少图片或预览画面差异过大时停止发布',async()=>{
  const files=[{buffer:Buffer.from('离线图片')}];
  for(const result of [{count:0,differences:[]},{count:1,differences:[[20]]}]) await assert.rejects(verifyUploadedImages({evaluate:async()=>result},files),/内容或顺序/);
});
