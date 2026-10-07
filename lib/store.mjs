import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isCartoonStyle, nextCartoonStyleId } from '../public/cartoon-styles.js';

export const now = () => new Date().toISOString();
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export class Store {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS materials(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metrics(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    `);
    if (!this.list('accounts').length) {
      this.put('accounts', { id: 'a', name: '账号 A', positioning: 'AI 项目与求职实践', platformIdentity: null });
      this.put('accounts', { id: 'b', name: '账号 B', positioning: 'AI 学习与大学生活效率', platformIdentity: null });
    }
    // 进程重启后，已经开始的提交必须核对平台结果，不能重新点击发布。
    for (const attempt of this.list('attempts')) {
      if (attempt.status === 'submitting') {
        this.put('attempts', { ...attempt, status: 'unknown', message: '提交期间程序中断，请先核对官方后台。' });
        const draft = this.get('drafts', attempt.draftId, attempt.accountId);
        if (draft) this.put('drafts', { ...draft, state: 'publish_unknown' });
      }
    }
    for(const draft of this.list('drafts')) {
      if(draft.processing) this.put('drafts',{...draft,processing:false,lastError:'上次处理期间程序中断；已有文字和设计链接已保留，请检查当前进度。'});
    }
  }

  close() { this.db.close(); }
  put(table, item) {
    const value = { ...item, updatedAt: now() };
    const scoped = ['materials', 'drafts', 'metrics', 'reviews', 'attempts'].includes(table);
    if (scoped) {
      this.db.prepare(`INSERT INTO ${table}(id,account_id,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,payload=excluded.payload`).run(value.id, value.accountId, JSON.stringify(value));
    } else {
      this.db.prepare(`INSERT INTO ${table}(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`).run(value.id, JSON.stringify(value));
    }
    return value;
  }
  get(table, id, accountId) {
    const row = accountId
      ? this.db.prepare(`SELECT payload FROM ${table} WHERE id=? AND account_id=?`).get(id, accountId)
      : this.db.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(id);
    return row ? JSON.parse(row.payload) : null;
  }
  list(table, accountId) {
    const rows = accountId
      ? this.db.prepare(`SELECT payload FROM ${table} WHERE account_id=? ORDER BY rowid DESC`).all(accountId)
      : this.db.prepare(`SELECT payload FROM ${table} ORDER BY rowid DESC`).all();
    return rows.map(row => JSON.parse(row.payload));
  }
  requireAccount(id) {
    const account = this.get('accounts', id);
    if (!account) throw fail('账号不存在。', 404);
    return account;
  }
  requireDraft(accountId, id) {
    this.requireAccount(accountId);
    const draft = this.get('drafts', id, accountId);
    if (!draft) throw fail('当前账号下没有这份稿件。', 404);
    return draft;
  }
  materialSelection(accountId, ids = []) {
    return ids.map(id => {
      const material = this.get('materials', id, accountId);
      if (!material) throw fail('所选素材不属于当前账号。');
      return material;
    });
  }
  createDraft(accountId, input) {
    this.requireAccount(accountId);
    this.materialSelection(accountId, input.materialIds);
    if (!input.topic?.trim()) throw fail('请填写主题。');
    return this.put('drafts', {
      id: randomUUID(), accountId, topic: input.topic.trim(), materialIds: input.materialIds || [],
      content: null, audit: null, state: 'draft', version: 1, textApproval: null,
      design: null, media: [], finalApproval: null, noteId: null,
      startedAt: now(), finishedAt: null, reworkCount: 0, reviewId: input.reviewId || null,
      sources: []
    });
  }
  saveContent(accountId, id, content, audit = null) {
    const draft = this.requireDraft(accountId, id);
    if (['submitting', 'submitted', 'published', 'publish_unknown'].includes(draft.state)) throw fail('已提交的稿件不能修改，请新建稿件。', 409);
    validateContent(content);
    return this.put('drafts', { ...draft, content, audit, state: 'text_review', version: draft.version + 1,
      textApproval: null, finalApproval: null, finishedAt: null, design: null, media: [], pngExport:null,
      reworkCount: draft.content ? draft.reworkCount + 1 : draft.reworkCount });
  }
  approveText(accountId, id) {
    const draft = this.requireDraft(accountId, id);
    if (draft.state !== 'text_review') throw fail('请先完成当前版本的生成和审稿。', 409);
    if (!draft.audit) throw fail('审稿尚未完成，请先重新审稿。', 409);
    validateContent(draft.content);
    return this.put('drafts', { ...draft, state: 'text_approved', textApproval: { version: draft.version, hash: digest(draft.content), at: now() } });
  }
  requireTextApproval(draft) {
    if (!draft.textApproval || draft.textApproval.version !== draft.version || draft.textApproval.hash !== digest(draft.content)) throw fail('文字已变化，请重新确认标题、正文及每页卡片。', 409);
  }
  requireCartoonDesign(draft) {
    const style=draft.design?.style;
    if(!isCartoonStyle(style?.id)||style.appliedPages!==draft.content.cards.length||draft.media.length!==draft.content.cards.length||JSON.stringify(style.verifiedMediaHashes)!==JSON.stringify(draft.media.map(m=>m.sha256))) throw fail('必须使用已核对的卡通风格图文；纯文字或旧图片不能发布，请完成卡通排版并重新确认。',409);
  }
  planCartoonDesign(draft) {
    if(draft.visualPlan) return draft.visualPlan;
    // 只参考风格编号与时间，不把其他账号的素材或内容用于本篇。
    const history=this.list('drafts').filter(item=>item.id!==draft.id).map(item=>({
      id:item.visualPlan?.styleId||item.design?.style?.id,
      at:item.visualPlan?.assignedAt||item.design?.verifiedAt||item.startedAt
    })).filter(item=>isCartoonStyle(item.id)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    const plan={styleId:draft.design?.style?.id||nextCartoonStyleId(history[0]?.id),variant:parseInt(draft.id.slice(0,8),16)%3,assignedAt:now()};
    this.put('drafts',{...draft,visualPlan:plan});
    return plan;
  }
  approveFinal(accountId, id) {
    const draft = this.requireDraft(accountId, id);
    if (!['design_ready', 'final_approved'].includes(draft.state)) throw fail('请先完成可画设计和图片导出。', 409);
    this.requireTextApproval(draft);
    if (!draft.design?.verifiedEditable || !draft.media?.length) throw fail('尚未验证可画可编辑设计或尚无导出图片。', 409);
    this.requireCartoonDesign(draft);
    const account = this.requireAccount(accountId);
    if (!account.platformIdentity) throw fail('请先核对并绑定当前小红书账号。', 409);
    const snapshot = { accountId, platformIdentity: account.platformIdentity, title: draft.content.title, body: draft.content.body, tags: draft.content.tags, images: draft.media.map(m => ({ filename: m.filename, sha256: m.sha256 })) };
    return this.put('drafts', { ...draft, state: 'final_approved', finishedAt: now(), finalApproval: { id: randomUUID(), snapshot, hash: digest(snapshot), at: now() } });
  }
  beginPublish(accountId, id) {
    const draft = this.requireDraft(accountId, id);
    const snapshot=this.requireFinalApproval(draft);
    const attempt = this.put('attempts', { id: randomUUID(), draftId: id, accountId, approvalId: draft.finalApproval.id, snapshot, status: 'submitting', startedAt: now() });
    this.put('drafts', { ...draft, state: 'submitting' });
    return attempt;
  }
  requirePublishPermission(draft,permission) {
    if(!permission||permission.consumedAt||permission.accountId!==draft.accountId||permission.draftId!==draft.id||permission.finalApprovalId!==draft.finalApproval?.id||permission.finalHash!==draft.finalApproval?.hash||permission.platformIdentity!==this.requireAccount(draft.accountId).platformIdentity) throw fail('未获得当前账号及版本的上传发布许可，或该许可已用于一次提交。',423);
    return this.requireFinalApproval(draft);
  }
  requireFinalApproval(draft) {
    const accountId=draft.accountId,id=draft.id;
    if (draft.state !== 'final_approved' || !draft.finalApproval) throw fail('请先确认当前版本的最终图文。', 409);
    this.requireTextApproval(draft);
    this.requireCartoonDesign(draft);
    const snapshot = { accountId, platformIdentity: this.requireAccount(accountId).platformIdentity, title: draft.content.title, body: draft.content.body, tags: draft.content.tags, images: draft.media.map(m => ({ filename: m.filename, sha256: m.sha256 })) };
    if (digest(snapshot) !== draft.finalApproval.hash) throw fail('账号或最终图文已变化，请重新确认。', 409);
    if (this.list('attempts', accountId).some(a => a.draftId === id && ['submitting', 'unknown', 'submitted', 'published'].includes(a.status))) throw fail('已有提交记录，请先核对结果，不能重复发布。', 409);
    return snapshot;
  }
  recordEvidence(input) { return this.put('evidence', { id: randomUUID(), at: now(), ...input }); }
}

export function validateContent(content) {
  if (!content || typeof content.title !== 'string' || !content.title.trim() || typeof content.body !== 'string' || !content.body.trim()) throw fail('标题和正文不能为空。');
  if (!Array.isArray(content.tags) || content.tags.some(tag => typeof tag !== 'string')) throw fail('话题格式不正确。');
  if (!Array.isArray(content.cards) || !content.cards.length || content.cards.some(c => typeof c.heading !== 'string' || !c.heading.trim() || typeof c.text !== 'string' || !c.text.trim())) throw fail('每页卡片需要标题和文字。');
}

export function normalizeMetrics(input) {
  const result = {};
  for (const key of ['views', 'impressions', 'likes', 'saves', 'comments', 'shares', 'followers']) {
    const value = input[key];
    if (value === '' || value === null || value === undefined) result[key] = null;
    else if (!Number.isFinite(Number(value)) || Number(value) < 0) throw fail('指标必须是非负数字；缺失时请留空。');
    else result[key] = Number(value);
  }
  return result;
}
