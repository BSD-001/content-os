import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { Store, normalizeMetrics } from '../lib/store.mjs';

const content = { title: '学习记录', body: '先读资料，再做自测。', tags: ['学习'], cards: [{ heading: '先理解', text: '说出自己的理解。' }] };
const setup = () => {
  const store = new Store(':memory:');
  const draft = store.createDraft('a', { topic: '如何自测' });
  store.saveContent('a', draft.id, structuredClone(content), { summary: '离线测试审稿样本', issues: [] });
  return { store, id: draft.id };
};
const finalReady = () => {
  const { store, id } = setup();
  store.approveText('a', id);
  store.put('accounts', { ...store.requireAccount('a'), platformIdentity: '账号真实标识' });
  store.put('drafts', { ...store.requireDraft('a', id), state: 'design_ready', design: { verifiedEditable: true,style:{id:'cartoon-notebook-v1',appliedPages:1,verifiedMediaHashes:['测试校验值']} }, media: [{ filename: '测试图片.png', sha256: '测试校验值' }] });
  store.approveFinal('a', id);
  return { store, id };
};

test('不同账号不能读取或修改对方稿件', () => {
  const { store, id } = setup();
  assert.throws(() => store.requireDraft('b', id), /当前账号/);
  assert.throws(() => store.saveContent('b', id, content), /当前账号/);
  store.close();
});
test('不能把另一账号的素材传给生成流程', () => {
  const store = new Store(':memory:');
  store.put('materials', { id: '素材', accountId: 'b', text: '真实经历' });
  assert.throws(() => store.createDraft('a', { topic: '主题', materialIds: ['素材'] }), /不属于/);
  store.close();
});
test('修改卡片文字使文字和最终确认失效', () => {
  const { store, id } = finalReady();
  const changed = structuredClone(content);
  changed.cards[0].text = '新的说明';
  const draft = store.saveContent('a', id, changed);
  assert.equal(draft.textApproval, null);
  assert.equal(draft.finalApproval, null);
  assert.equal(draft.media.length, 0);
  assert.throws(() => store.beginPublish('a', id), /确认/);
  store.close();
});
test('未经最终确认不能发布', () => {
  const { store, id } = setup();
  store.approveText('a', id);
  assert.throws(() => store.beginPublish('a', id), /最终图文/);
  store.close();
});
test('模型审稿失败时不能确认文字', () => {
  const { store, id } = setup();
  store.put('drafts', { ...store.requireDraft('a', id), audit: null });
  assert.throws(() => store.approveText('a', id), /审稿尚未完成/);
  store.close();
});
test('未验证可编辑的设计不能确认发布', () => {
  const { store, id } = setup();
  store.approveText('a', id);
  store.put('drafts', { ...store.requireDraft('a', id), state: 'design_ready', design: { verifiedEditable: false }, media: [{ filename: '图片', sha256: '校验值' }] });
  assert.throws(() => store.approveFinal('a', id), /可编辑/);
  store.close();
});
test('账号身份变化后不能使用原确认发布', () => {
  const { store, id } = finalReady();
  store.put('accounts', { ...store.requireAccount('a'), platformIdentity: '另一个账号' });
  assert.throws(() => store.beginPublish('a', id), /重新确认/);
  store.close();
});
test('旧的纯文字设计不能确认最终图文或沿用旧确认发布',()=>{
  const {store,id}=finalReady();
  store.put('drafts',{...store.requireDraft('a',id),design:{verifiedEditable:true}});
  assert.throws(()=>store.approveFinal('a',id),/卡通风格/);
  assert.throws(()=>store.beginPublish('a',id),/卡通风格/);
  store.close();
});
test('卡通风格核对绑定图片，替换图片后必须重新检查',()=>{
  const {store,id}=finalReady();
  store.put('drafts',{...store.requireDraft('a',id),media:[{filename:'未核对.png',sha256:'未核对的图片'}]});
  assert.throws(()=>store.approveFinal('a',id),/旧图片/);
  store.close();
});
test('替换图片或改变顺序后不能使用原确认', () => {
  const { store, id } = finalReady();
  store.put('drafts', { ...store.requireDraft('a', id), media: [{ filename: '替换.png', sha256: '不同图片' }] });
  assert.throws(() => store.beginPublish('a', id), /重新确认/);
  store.close();
});
test('双击提交只能产生一次尝试', () => {
  const { store, id } = finalReady();
  store.beginPublish('a', id);
  assert.throws(() => store.beginPublish('a', id), /确认/);
  assert.equal(store.list('attempts', 'a').length, 1);
  store.close();
});
test('未知提交结果不能盲目重发', () => {
  const { store, id } = finalReady();
  const attempt = store.beginPublish('a', id);
  store.put('attempts', { ...attempt, status: 'unknown' });
  store.put('drafts', { ...store.requireDraft('a', id), state: 'final_approved' });
  assert.throws(() => store.beginPublish('a', id), /不能重复发布/);
  store.close();
});
test('上传发布许可必须绑定具体账号、稿件和最终版本',()=>{
  const {store,id}=finalReady();const d=store.requireDraft('a',id);
  const permission={accountId:'a',draftId:id,platformIdentity:'账号真实标识',finalApprovalId:d.finalApproval.id,finalHash:d.finalApproval.hash};
  assert.deepEqual(store.requirePublishPermission(d,permission),d.finalApproval.snapshot);
  for(const changed of [{accountId:'b'},{draftId:'另一篇'},{finalHash:'另一版'},{finalApprovalId:'另一确认'},{platformIdentity:'另一身份'}]) assert.throws(()=>store.requirePublishPermission(d,{...permission,...changed}),/上传发布许可/);
  store.close();
});
test('未授权或已用于一次提交的许可不能开始发布',()=>{
  const {store,id}=finalReady();const d=store.requireDraft('a',id);
  assert.throws(()=>store.requirePublishPermission(d,null),/上传发布许可/);
  assert.throws(()=>store.requirePublishPermission(d,{accountId:'a',draftId:id,platformIdentity:'账号真实标识',finalApprovalId:d.finalApproval.id,finalHash:d.finalApproval.hash,consumedAt:new Date().toISOString()}),/一次提交/);
  store.close();
});
test('缺失指标和真实零分别保存', () => {
  const metrics = normalizeMetrics({ likes: 0, views: '', saves: null });
  assert.equal(metrics.likes, 0);
  assert.equal(metrics.views, null);
  assert.equal(metrics.saves, null);
  assert.throws(() => normalizeMetrics({ views: -1 }), /非负/);
});
test('重启恢复稿件并把中断的发布标为结果不确定', () => {
  const dir = mkdtempSync(join(tmpdir(), 'content-os-test-'));
  const filename = join(dir, 'test.sqlite');
  let store = new Store(filename);
  const draft = store.createDraft('a', { topic: '持久化测试' });
  store.put('drafts',{...draft,processing:true,design:{url:'https://www.canva.cn/design/离线样本/edit'}});
  store.put('attempts', { id: '尝试', draftId: draft.id, accountId: 'a', status: 'submitting' });
  store.close();
  store = new Store(filename);
  assert.equal(store.requireDraft('a', draft.id).topic, '持久化测试');
  assert.equal(store.requireDraft('a', draft.id).state, 'publish_unknown');
  assert.equal(store.requireDraft('a', draft.id).processing,false);
  assert.equal(store.requireDraft('a', draft.id).design.url,'https://www.canva.cn/design/离线样本/edit');
  assert.equal(store.get('attempts', '尝试', 'a').status, 'unknown');
  store.close();
  assert.equal(dirname(resolve(dir)),resolve(tmpdir()));
  assert.ok(basename(dir).startsWith('content-os-test-'));
  rmSync(dir, { recursive: true });
});
