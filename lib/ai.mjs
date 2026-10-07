import { readFileSync } from 'node:fs';
import { fail } from './store.mjs';

const prompt = name => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8');

export class DeepSeek {
  constructor(credentials,controls=()=>({}),saveControls=()=>{}) { this.credentials = credentials; this.controls=controls; this.saveControls=saveControls; this.queue=Promise.resolve(); }
  async request(path, options = {}) {
    if(path==='/chat/completions'&&this.controls().paidAiPaused) throw fail('你已要求暂停付费模型调用；测试总预算上限为 5 元，等待你恢复授权。',423);
    const key = this.credentials().deepseekKey || process.env.DEEPSEEK_API_KEY;
    if (!key) throw fail('请在设置中填写 DeepSeek API 密钥。', 409);
    let response;
    try {
      response = await fetch(`https://api.deepseek.com${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(90000) });
    } catch { throw fail('DeepSeek 连接超时或网络不可达，请检查网络后重试。', 502); }
    if (!response.ok) {
      const messages = { 401: 'DeepSeek 密钥无效。', 402: 'DeepSeek 余额不足。', 429: 'DeepSeek 请求过于频繁，请稍后重试。' };
      throw fail(messages[response.status] || `DeepSeek 返回错误（${response.status}）。`, 502);
    }
    return response.json();
  }
  async json(role, data) {
    const previous=this.queue;
    let release;
    this.queue=new Promise(resolve=>release=resolve);
    await previous;
    try { return await this.callJson(role,data); } finally { release(); }
  }
  async callJson(role,data) {
    const control=this.controls();
    if(control.paidAiPaused) throw fail('付费 DeepSeek 调用已按你的要求暂停。',423);
    const model = this.credentials().model || 'deepseek-flash';
    const payload={model,messages:[{role:'system',content:prompt(role)},{role:'user',content:JSON.stringify(data)}],response_format:{type:'json_object'},thinking:{type:'disabled'},max_tokens:4096,stream:false};
    const price=control.pricing?.[model];
    if(!price||!Number.isFinite(control.baselineCny)) throw fail('测试预算或模型价格尚未核对，暂不执行付费调用。',423);
    if(!control.pricingCheckedAt||Date.now()-Date.parse(control.pricingCheckedAt)>86400000) throw fail('预算保护所用价格超过一天，需先核对官方价格；未执行付费调用。',423);
    const balance=await this.request('/user/balance');
    const current=balance.balance_infos?.find(item=>item.currency==='CNY');
    if(!current||!Number.isFinite(Number(current.total_balance))) throw fail('当前人民币余额无法核对，未执行付费调用。',423);
    const used=Math.max(control.spentUpperBoundCny||0,control.baselineCny-Number(current.total_balance),0);
    const maximum=estimateMaximumCost(payload,price);
    const limit=Math.min(control.testBudgetCny||0,5);
    if(used+maximum>limit) throw fail('本次调用的费用上界会超出测试总预算 5 元，已停止。',423);
    // 调用前占用费用上界；网络中断时保留占用，不把未知扣费当作免费。
    this.saveControls({...this.controls(),spentUpperBoundCny:used+maximum,currentBalanceCny:Number(current.total_balance),balanceCheckedAt:new Date().toISOString()});
    const result = await this.request('/chat/completions', { method:'POST',body:JSON.stringify(payload) });
    const usage=result.usage;
    if(Number.isFinite(usage?.prompt_tokens)&&Number.isFinite(usage?.completion_tokens)) {
      const upper=(usage.prompt_tokens*price.input+usage.completion_tokens*price.output)/1e6;
      this.saveControls({...this.controls(),spentUpperBoundCny:used+upper,lastUsage:{model,...usage,costUpperBoundCny:upper,at:new Date().toISOString()}});
    }
    if(result.choices?.[0]?.finish_reason==='length') throw fail('模型输出达到长度上限，原稿已保存；可以缩短审稿任务后重试。',502);
    try { return { value: JSON.parse(result.choices[0].message.content), usage: result.usage, model }; }
    catch { throw fail('模型返回的内容格式无法读取，请重试；原稿已保留。', 502); }
  }
  async verify() {
    const balance = await this.request('/user/balance');
    const models = await this.request('/models');
    const model = this.credentials().model || 'deepseek-flash';
    if (!models.data?.some(item => item.id === model)) throw fail(`该密钥无法使用模型 ${model}，请核对模型名称。`, 409);
    const result = await this.json('reviewer', { title: '连接验证', body: '这是一条 API 连接验证，不用于发布。', cards: [{ heading: '连接验证', text: '检查接口能否返回审稿结果。' }] });
    return { available: balance.is_available, balance: balance.balance_infos, model, usage: result.usage, verifiedAt: new Date().toISOString() };
  }
}

export function estimateMaximumCost(payload,price) {
  // UTF-8 字节数加消息开销作为输入 token 的保守上界，输出按完整长度及高峰价计。
  const inputUpper=Buffer.byteLength(JSON.stringify(payload),'utf8')+1024;
  return Math.ceil((inputUpper*price.input+payload.max_tokens*price.output))/1e6;
}
