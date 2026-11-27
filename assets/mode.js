/**
 * [INPUT]: 依赖 md.js 的 escapeHtml；读取 window.MUSICA_MODE。
 * [OUTPUT]: 导出 STATIC_MODE，以及 adminCreate / adminEdit / adminDelete 三个管理按钮片段。
 * [POS]: 本地编辑版与静态发布版的唯一开关。静态版由 deploy/assets/site-data.js 在 app.js
 *        之前设置 window.MUSICA_MODE = 'static'，因此页面不渲染任何新增、编辑、删除入口。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

import { escapeHtml as esc } from './md.js';

export const STATIC_MODE = typeof window !== 'undefined' && window.MUSICA_MODE === 'static';

/** 索引页顶部的新增按钮；静态版返回空串。 */
export function adminCreate(kind, label) {
  if (STATIC_MODE) return '';
  return `
    <div class="page-admin">
      <button class="admin-btn" type="button" data-create="${esc(kind)}">+ ${esc(label)}</button>
    </div>
  `;
}

/** 详情页档案区的编辑按钮；静态版返回空串。 */
export function adminEdit(kind, key, label = '编辑') {
  if (STATIC_MODE) return '';
  return `<button class="admin-btn" type="button" data-edit="${esc(kind)}" data-key="${esc(key)}">${esc(label)}</button>`;
}

/** 详情页的删除按钮；静态版返回空串。 */
export function adminDelete(kind, key, label = '删除') {
  if (STATIC_MODE) return '';
  return `<button class="admin-btn admin-btn--danger" type="button" data-delete="${esc(kind)}" data-key="${esc(key)}">${esc(label)}</button>`;
}
