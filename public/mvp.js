import { cartoonStyles } from './cartoon-styles.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const labels={draft:'待写文字',text_review:'文字待核对',text_approved:'文字已确认',png_ready:'图片已生成',design_ready:'历史设计',final_approved:'历史已确认',published:'历史已发布',submitted:'历史已提交',publish_unknown:'历史结果待核对'};
const types={experience:'真实经历',notes:'学习笔记',reference:'参考资料'};
const requested=new URLSearchParams(location.search);
let state,data,accountId=requested.get('account')||localStorage.getItem('content-os-account')||'a',draftId=requested.get('draft'),busy=false,loading=false,editingMaterial=null,editingContent=null;
const main=document.querySelector('#main');
const account=()=>state.accounts.find(item=>item.id===accountId);
const path=suffix=>`/api/accounts/${accountId}${suffix}`;
const current=()=>data.drafts.find(item=>item.id===draftId);
const locked=draft=>['submitting','submitted','published','publish_unknown'].includes(draft?.state);
const button=(action,text,primary=false,disabled=false,extra='')=>`<button data-action="${action}" class="${primary?'primary':''}" ${busy||disabled?'disabled':''} ${extra}>${text}</button>`;
const badge=text=>`<span class="badge">${esc(text)}</span>`;
const heading=(title,text)=>`<div class="page-heading"><div><span class="eyebrow">${esc(account().name)} · CONTENT OS MVP</span><h1>${title}</h1><p class="subtext">${text}</p></div></div>`;
const time=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
const safeUrl=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?esc(url.href):'#';}catch{return '#';}};
function toast(text){const node=document.querySelector('#toast');node.textContent=text;node.hidden=false;setTimeout(()=>node.hidden=true,6000);}
async function api(endpoint,body,method='POST'){
  const response=await fetch(endpoint,{method:body===undefined?'GET':method,headers:{'Content-Type':'application/json','X-Content-OS':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();
  if(!response.ok) throw Error(result.error||'操作未完成。');
  return result;
}
async function refresh(){
  loading=true;
  main.innerHTML='<p class="empty">正在加载当前账号…</p>';
  state=await api('/api/state');
  if(!state.accounts.some(item=>item.id===accountId))accountId=state.accounts[0].id;
  const requestedAccount=accountId,result=await api(path('/data'));
  if(requestedAccount!==accountId)return refresh();
  data=result;
  document.querySelector('#account-switch').innerHTML=state.accounts.map(item=>`<option value="${esc(item.id)}" ${item.id===accountId?'selected':''}>${esc(item.name)} · ${esc(item.positioning)}</option>`).join('');
  document.querySelector('#connection-summary').textContent='本地编辑和出图 · 手动发布';
  loading=false;
  render();
}
function render(){
  if(loading)return;
  const page=location.hash.slice(1)||'overview';
  document.querySelectorAll('nav a').forEach(node=>node.classList.toggle('active',node.dataset.page===page));
  const screens={overview,materials,studio,analytics,settings};
  main.innerHTML=(screens[page]||overview)();
}
function overview(){
  const exported=data.drafts.filter(item=>item.pngExport).length;
  return heading('把一篇图文做好。','整理素材、编辑文字、换一套卡通风格，再下载图片。')+
    `<div class="grid two">${state.accounts.map(item=>`<section class="panel ${item.id===accountId?'selected':''}"><div class="panel-head"><h2>${esc(item.name)}</h2>${badge(item.id===accountId?'当前账号':'独立工作空间')}</div><p>${esc(item.positioning)}</p>${button('switch-account','进入内容工作台 →',true,false,`data-id="${item.id}"`)}</section>`).join('')}</div>
    <section class="panel section"><h2>当前账号</h2><div class="stats"><div><strong>${data.materials.length}</strong><small>已保存素材</small></div><div><strong>${data.drafts.length}</strong><small>本地稿件</small></div><div><strong>${exported}</strong><small>MVP 图片包</small></div></div></section>
    <section class="panel section"><h2>三个步骤，完成一篇</h2><p>① 在素材库记录真实经历或学习笔记。<br>② 在工作台生成文案，或直接填写并保存文字。<br>③ 生成卡通图片预览，检查后下载整篇图片包，由你手动发布。</p><a class="link-button" href="#studio">开始创作 →</a></section>`;
}
function materials(){
  return heading('你的素材，才是内容的底气。','每个账号分别保存真实经历、笔记和来源。')+
    `<div class="grid two"><section class="panel"><h2>${editingMaterial?'编辑素材':'添加素材'}</h2><form id="material-form" class="form-grid"><label>素材名称<input name="title" required maxlength="120" value="${esc(editingMaterial?.title)}"></label><label>素材类型<select name="type">${Object.entries(types).map(([key,label])=>`<option value="${key}" ${editingMaterial?.type===key?'selected':''}>${label}</option>`).join('')}</select></label><label>素材内容<textarea name="text" required rows="7">${esc(editingMaterial?.text)}</textarea></label><label>参考链接（选填）<input name="url" type="url" value="${esc(editingMaterial?.url)}" placeholder="https://"></label><div class="actions">${button('save-material','保存到当前账号',true)}${editingMaterial?button('cancel-material','取消编辑'):''}</div></form></section><section><div class="panel-head"><h2>已保存素材</h2>${badge(data.materials.length+' 条')}</div><div class="material-list">${data.materials.length?data.materials.map(item=>`<article class="material"><div class="panel-head"><h3>${esc(item.title)}</h3>${badge(types[item.type])}</div><p>${esc(item.text)}</p>${item.url?`<a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">查看来源 ↗</a>`:''}<div class="actions">${button('edit-material','编辑',false,false,`data-id="${item.id}"`)}${button('delete-material','删除',false,false,`data-id="${item.id}"`)}</div></article>`).join(''):'<div class="panel empty">还没有素材，先存一条真实经历。</div>'}</div></section></div>`;
}
function blankContent(){return {title:'',body:'',tags:[],cards:Array.from({length:4},()=>({heading:'',text:''}))};}
function studio(){
  const draft=current(),content=editingContent||draft?.content||blankContent(),isLocked=locked(draft);
  const savedExport=draft?.pngExport;
  const aiDisabled=state.settings.paidAiPaused||!state.settings.deepseekConfigured||isLocked;
  const editor=draft?`<section class="panel"><div class="panel-head"><h2>${esc(draft.topic)}</h2>${badge(labels[draft.state]||draft.state)}</div>${draft.lastError?`<div class="notice error">${esc(draft.lastError)}</div>`:''}${isLocked?'<div class="notice">这是此前的真实提交记录，保留原稿和图片。新内容请另建稿件。</div>':''}
    <form id="content-form" class="form-grid"><label>标题<input name="title" required value="${esc(content.title)}" ${isLocked?'disabled':''}></label><label>正文<textarea name="body" required rows="6" ${isLocked?'disabled':''}>${esc(content.body)}</textarea></label><label>话题（空格分隔）<input name="tags" value="${esc(content.tags.join(' '))}" ${isLocked?'disabled':''}></label><h3 class="spacer">卡片文字 · ${content.cards.length} 页</h3>${content.cards.map((card,index)=>`<div class="card-editor"><div class="panel-head"><span class="eyebrow">第 ${index+1} 页</span>${button('remove-card','删除本页',false,isLocked||content.cards.length===1,`data-index="${index}"`)}</div><label>页标题（可换行）<textarea name="heading-${index}" required rows="2" ${isLocked?'disabled':''}>${esc(card.heading)}</textarea></label><label class="spacer">页文字<textarea name="text-${index}" required ${isLocked?'disabled':''}>${esc(card.text)}</textarea></label></div>`).join('')}
    <div class="actions">${button('add-card','＋ 加一页',false,isLocked||content.cards.length>=9)}${button('save-content','保存文字',true,isLocked)}${button('generate',draft.content?'重新生成并审稿':'AI 生成并审稿',false,aiDisabled)}${button('audit','AI 审稿当前文字',false,aiDisabled||!draft.content)}</div></form>
    <p class="muted spacer">保存文字和生成图片免费。AI 操作会将本篇文案及所选素材发送到 DeepSeek，按 API 用量收费。${state.settings.paidAiPaused?'当前 AI 调用暂停，可先手写；需要时到设置中启用。':''}</p>
    ${draft.audit?`<div class="audit"><h3>当前版本的审稿建议</h3><p>${esc(draft.audit.summary)}</p>${draft.audit.issues?.length?`<ul>${draft.audit.issues.map(item=>`<li><strong>${esc(item.location)} · ${esc(item.severity)}</strong><br>${esc(item.reason)}<br>建议：${esc(item.suggestion)}</li>`).join('')}</ul>`:'<p>模型未列出问题；发布前仍需自己核对。</p>'}</div>`:'<p class="muted spacer">当前文字尚未经过 AI 审稿；请核对事实和表述。</p>'}</section>
    <section class="panel section"><div class="panel-head"><h2>${isLocked?'历史图片':'卡通图片预览'}</h2>${badge(savedExport?.styleName||'新稿自动轮换风格')}</div>${!isLocked?`<p class="subtext">奶油手帐 → 漫画分镜 → 彩色贴纸，逐篇轮换。同一篇各页保持一致；文字在上方修改。</p><div class="actions">${button('render-png','生成图片预览',true,!draft.content)}${button('download','下载整篇 PNG（ZIP）',false,!savedExport)}${button('copy-content','复制标题和正文',false,!draft.content)}</div>`:`<p class="subtext">历史真实发布记录保留：${esc(draft.noteId||'结果尚未核对')}。</p>${button('copy-content','复制标题和正文',false,!draft.content)}`}
    ${draft.media?.length?`<div class="export-images spacer">${draft.media.map((item,index)=>`<a href="/media/${esc(item.filename)}" download><img src="/media/${esc(item.filename)}" alt="第 ${index+1} 页完整图片"><span class="muted">第 ${index+1} 页 · 点图下载</span></a>`).join('')}</div>`:'<div class="empty">保存文字后生成预览，全部图片会显示在这里。</div>'}
    ${savedExport?`<p class="muted spacer">1080 × 1440 · ${savedExport.media.length} 张 PNG · 生成于 ${time(savedExport.renderedAt)}。图片包同时包含文案.txt。</p>`:''}<p class="subtext spacer">下载前请逐页核对。导出后由你在小红书手动上传和发布。</p></section>`:
    `<section class="panel"><h2>一个主题，加上已有素材。</h2><form id="draft-form" class="form-grid"><label>这次想分享什么？<input name="topic" required maxlength="200" placeholder="例如：一次 AI 项目的真实调试记录"></label><div><label>选用当前账号的素材</label>${data.materials.map(item=>`<label class="check"><input name="materialIds" type="checkbox" value="${item.id}">${esc(item.title)}</label>`).join('')||'<p class="muted spacer">可以先存素材，也可以直接开始写文字。</p>'}</div>${button('create-draft','保存主题，开始创作',true)}</form></section>`;
  return heading('一篇内容，从这里开始。','保存文字 → 生成图片预览 → 下载整篇，由你手动发布。')+`<div class="studio-grid"><section class="panel"><h2>当前账号稿件</h2>${button('new-draft','＋ 新建稿件',true)}<div class="draft-list">${data.drafts.map(item=>`<button class="draft-link ${item.id===draftId?'active':''}" data-action="select-draft" data-id="${item.id}"><strong>${esc(item.content?.title||item.topic)}</strong><small>${labels[item.state]||item.state}</small></button>`).join('')}</div></section><div>${editor}</div></div>`;
}
function analytics(){
  return heading('数据复盘已暂停。','最小 MVP 先完成稳定创作和出图。')+`<section class="panel"><p>可画自动创建、小红书自动发布、自动读数和反馈生成已移出本版。</p><p class="subtext">已保存的历史记录仍在本机。当前账号有 ${data.drafts.filter(item=>item.state==='published').length} 篇此前已核对的真实发布记录，${data.metrics.length} 条历史数据快照；缺失指标不视为零。</p><a class="link-button" href="#studio">返回内容工作台 →</a></section>`;
}
function settings(){
  return heading('设置好，开始创作。','本地编辑和出图不需要可画或小红书登录。')+
    `<section class="panel"><h2>DeepSeek · 可选</h2><form id="settings-form" class="form-grid"><label>API 密钥<input name="deepseekKey" type="password" autocomplete="new-password" placeholder="${state.settings.deepseekConfigured?'已配置；留空保留原密钥':'只在这里填写，不要发送到聊天'}"></label><label>模型<input name="model" value="${esc(state.settings.model)}"></label><label class="check"><input name="allowPaidAi" type="checkbox" ${state.settings.paidAiPaused?'':'checked'}>允许我点击 AI 按钮时调用 DeepSeek</label><details><summary>预算保护使用的模型价格</summary><p class="subtext">价格按人民币 / 每百万 tokens 填写。核对 <a href="https://api-docs.deepseek.com/zh-cn/quick_start/pricing/" target="_blank" rel="noopener noreferrer">DeepSeek 官方价格</a> 后再勾选确认；当前核对时间 ${time(state.settings.pricingCheckedAt)}。</p><div class="split-form"><label>输入价格（缓存未命中）<input name="inputPrice" type="number" min="0.000001" step="any" value="${esc(state.settings.pricing?.input)}"></label><label>输出价格<input name="outputPrice" type="number" min="0.000001" step="any" value="${esc(state.settings.pricing?.output)}"></label></div><label class="check"><input name="confirmPricing" type="checkbox">已核对上述价格，可用于接下来 24 小时的预算保护</label></details><p class="subtext">启用后仅在你点击生成或审稿时调用。当前测试总预算上限 5 元，已记录费用上界 ${esc(state.settings.spentUpperBoundCny??0)} 元；预算或价格无法核对时会阻止请求。密钥保存到本机，不回显。</p>${button('save-settings','保存设置',true)}</form></section>
    <section class="panel section"><h2>当前账号定位</h2><form id="account-form" class="form-grid"><label>账号名称<input name="name" required value="${esc(account().name)}"></label><label>内容定位<textarea name="positioning" required>${esc(account().positioning)}</textarea></label>${button('save-account','保存当前账号定位')}</form></section>`;
}
function readContent(){
  const form=document.querySelector('#content-form'),content=editingContent||current()?.content||blankContent();
  return {...content,title:form.elements.title.value,body:form.elements.body.value,tags:form.elements.tags.value.split(/\s+/).filter(Boolean),cards:content.cards.map((card,index)=>({heading:form.elements['heading-'+index].value,text:form.elements['text-'+index].value}))};
}
function hasUnsaved(){
  return !!document.querySelector('#content-form')&&!locked(current())&&JSON.stringify(readContent())!==JSON.stringify(current()?.content||blankContent());
}
document.querySelector('#account-switch').addEventListener('change',async event=>{if(hasUnsaved()){event.target.value=accountId;toast('文字有未保存修改，请先保存文字。');return;}accountId=event.target.value;localStorage.setItem('content-os-account',accountId);draftId=null;editingMaterial=null;editingContent=null;await refresh();});
window.addEventListener('hashchange',()=>state&&render());
window.addEventListener('beforeunload',event=>{if(hasUnsaved()){event.preventDefault();event.returnValue='';}});
document.addEventListener('submit',event=>event.preventDefault());
document.addEventListener('click',async event=>{
  const link=event.target.closest('a[href^="#"]');
  if(link&&hasUnsaved()){event.preventDefault();toast('文字有未保存修改，请先保存文字。');return;}
  const target=event.target.closest('[data-action]');
  if(!target||busy)return;
  const action=target.dataset.action;
  if(['switch-account','select-draft','new-draft','render-png','download','copy-content','generate','audit'].includes(action)&&hasUnsaved()){toast('文字有未保存修改，请先保存文字。');return;}
  if(action==='switch-account'){accountId=target.dataset.id;localStorage.setItem('content-os-account',accountId);draftId=null;editingContent=null;await refresh();location.hash='studio';return;}
  if(action==='select-draft'||action==='new-draft'){draftId=action==='new-draft'?null:target.dataset.id;editingContent=null;render();return;}
  if(action==='edit-material'||action==='cancel-material'){editingMaterial=action==='edit-material'?data.materials.find(item=>item.id===target.dataset.id):null;render();return;}
  if(action==='add-card'||action==='remove-card'){editingContent=readContent();if(action==='add-card')editingContent.cards.push({heading:'',text:''});else editingContent.cards.splice(Number(target.dataset.index),1);render();return;}
  if(action==='download'){location.href=path(`/drafts/${draftId}/download`);return;}
  if(action==='copy-content'){const content=current().content;try{await navigator.clipboard.writeText(content.title+'\n\n'+content.body+'\n\n'+content.tags.map(tag=>'#'+tag.replace(/^#/,'')).join(' '));toast('标题、正文和话题已复制。');}catch{toast('复制失败，可从上方文本框或图片包内的文案.txt 取用。');}return;}
  const values=id=>Object.fromEntries(new FormData(document.querySelector('#'+id)));
  let endpoint,body={},message='已完成。';
  if(action==='save-material'){const form=document.querySelector('#material-form');if(!form.reportValidity())return;body={...values('material-form'),id:editingMaterial?.id};endpoint=path('/materials');message='素材已保存。';}
  if(action==='delete-material'){endpoint=path('/materials/'+target.dataset.id);message='素材已删除。';}
  if(action==='create-draft'){const form=document.querySelector('#draft-form');if(!form.reportValidity())return;body={topic:form.elements.topic.value,materialIds:new FormData(form).getAll('materialIds')};endpoint=path('/drafts');message='主题已保存，可以写文字了。';}
  if(action==='save-content'){if(!document.querySelector('#content-form').reportValidity())return;body={content:readContent()};endpoint=path(`/drafts/${draftId}/content`);message='文字已保存；图片预览已失效，请重新生成。';}
  if(['generate','audit','render-png'].includes(action)){endpoint=path(`/drafts/${draftId}/${action}`);message=({generate:'文案已生成并审稿。',audit:'审稿已完成。','render-png':'全部图片已生成，请逐页检查后下载。'})[action];}
  if(action==='save-settings'){const form=document.querySelector('#settings-form');body={...values('settings-form'),allowPaidAi:form.elements.allowPaidAi.checked,confirmPricing:form.elements.confirmPricing.checked};endpoint='/api/settings';message='设置已保存；不会自动调用模型。';}
  if(action==='save-account'){if(!document.querySelector('#account-form').reportValidity())return;body=values('account-form');endpoint=path('');message='当前账号定位已保存。';}
  if(!endpoint)return;
  const previousLabel=target.textContent,inputs=[...main.querySelectorAll('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')];
  let refreshed=false;
  inputs.forEach(node=>node.disabled=true);
  document.querySelector('#account-switch').disabled=true;
  busy=true;target.disabled=true;target.textContent='正在处理…';
  try{const result=await api(endpoint,body,action==='delete-material'?'DELETE':'POST');if(action==='create-draft')draftId=result.id;if(action==='save-material')editingMaterial=null;editingContent=null;toast(result.message||message);await refresh();refreshed=true;}
  catch(error){toast(error.message);if(['generate','audit','render-png'].includes(action)&&!hasUnsaved()){try{await refresh();refreshed=true;}catch{main.innerHTML='<div class="notice error">本地服务不可达，请重新运行启动脚本。</div>';}}}
  finally{busy=false;inputs.forEach(node=>node.disabled=false);document.querySelector('#account-switch').disabled=false;if(refreshed)render();else if(target.isConnected){target.disabled=false;target.textContent=previousLabel;}}
});
refresh().catch(error=>{main.innerHTML=`<div class="notice error">${esc(error.message)} 请重新运行启动脚本。</div>`;});

