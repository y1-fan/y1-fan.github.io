/**
 * [INPUT]: 依赖 data.js 的 loadSearchIndex；依赖 DOM 中的 #search-dialog 结构。
 * [OUTPUT]: 导出 initSearch、openSearch。
 * [POS]: 全站搜索浮层。它只负责检索与选择，不参与路由；条目链接交回 hash 路由。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

import { loadSearchIndex } from './data.js';

const MAX_RESULTS = 30;

let dialog;
let input;
let results;
let count;
let docsPromise;
let requestId = 0;
let debounceTimer = 0;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 给文本片段加高亮，全部通过 DOM 节点写入，避免拼接 HTML。 */
function highlight(text, tokens) {
  const fragment = document.createDocumentFragment();
  if (!tokens.length) {
    fragment.append(text);
    return fragment;
  }

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  let last = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > last) fragment.append(text.slice(last, match.index));
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    fragment.append(mark);
    last = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex += 1;
    match = pattern.exec(text);
  }

  if (last < text.length) fragment.append(text.slice(last));
  return fragment;
}

function snippetFor(doc, tokens) {
  const text = doc.text || '';
  const lower = text.toLowerCase();
  let foundAt = -1;

  for (const token of tokens) {
    const at = lower.indexOf(token);
    if (at !== -1 && (foundAt === -1 || at < foundAt)) foundAt = at;
  }

  if (foundAt === -1) {
    return doc.summary || text.slice(0, 110);
  }

  const start = Math.max(0, foundAt - 36);
  const end = Math.min(text.length, foundAt + 104);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

function rank(docs, query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return docs.map((doc) => ({ doc, tokens }));

  const ranked = [];

  for (const doc of docs) {
    const title = String(doc.title || '').toLowerCase();
    const composer = String(doc.composer || '').toLowerCase();
    const original = String(doc.original || '').toLowerCase();
    const composerOriginal = String(doc.composerOriginal || '').toLowerCase();
    const tags = (doc.tags || []).join(' ').toLowerCase();
    const aliases = (doc.aliases || []).join(' ').toLowerCase();
    const text = String(doc.text || '').toLowerCase();

    let score = 0;
    let matchedEveryToken = true;

    for (const token of tokens) {
      let tokenScore = 0;

      if (title === token) tokenScore = Math.max(tokenScore, 60);
      else if (title.includes(token)) tokenScore = Math.max(tokenScore, 24);
      if (composer.includes(token)) tokenScore = Math.max(tokenScore, 14);
      if (aliases.includes(token)) tokenScore = Math.max(tokenScore, 12);
      if (original.includes(token) || composerOriginal.includes(token)) {
        tokenScore = Math.max(tokenScore, 8);
      }
      if (tags.includes(token)) tokenScore = Math.max(tokenScore, 8);
      if (text.includes(token)) tokenScore = Math.max(tokenScore, 2);

      if (!tokenScore) {
        matchedEveryToken = false;
        break;
      }
      score += tokenScore;
    }

    if (matchedEveryToken) ranked.push({ doc, score, tokens });
  }

  return ranked
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title, 'zh-Hans'))
    .slice(0, MAX_RESULTS);
}

function buildResult(doc, tokens) {
  const link = document.createElement('a');
  link.className = 'search-result';
  link.href = `#/work/${encodeURIComponent(doc.slug)}`;

  const title = document.createElement('span');
  title.className = 'result-title';
  title.textContent = doc.title;
  if (doc.original) {
    const original = document.createElement('span');
    original.className = 'result-original';
    original.lang = 'en';
    original.textContent = doc.original;
    title.append(original);
  }

  const meta = document.createElement('span');
  meta.className = 'result-meta';
  meta.textContent = [doc.composer, doc.genre, doc.year].filter(Boolean).join(' · ');

  const snippet = document.createElement('span');
  snippet.className = 'result-snippet';
  snippet.append(highlight(snippetFor(doc, tokens), tokens));

  link.append(title, meta, snippet);
  link.addEventListener('click', () => dialog.close());
  return link;
}

function renderMessage(text) {
  const empty = document.createElement('p');
  empty.className = 'search-empty';
  empty.textContent = text;
  count.textContent = '';
  results.replaceChildren(empty);
}

async function render(rawQuery) {
  const id = ++requestId;
  const query = rawQuery.trim();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

  results.setAttribute('aria-busy', 'true');

  let docs;
  try {
    docs = await (docsPromise ||= loadSearchIndex().then((data) => data.docs || []));
  } catch (error) {
    if (id !== requestId) return;
    docsPromise = null;
    results.removeAttribute('aria-busy');
    renderMessage('搜索索引没有加载成功，请稍后重试。');
    return;
  }

  if (id !== requestId) return;
  results.removeAttribute('aria-busy');

  if (!query) {
    const fragment = document.createDocumentFragment();
    for (const doc of docs) fragment.append(buildResult(doc, []));
    results.replaceChildren(fragment);
    count.textContent = `${docs.length} 部作品`;
    return;
  }

  const matches = rank(docs, query);
  if (!matches.length) {
    renderMessage(`没有找到与“${query}”相关的条目。试试作曲家、作品名或“命运”这样的别名。`);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const match of matches) fragment.append(buildResult(match.doc, match.tokens));
  results.replaceChildren(fragment);
  count.textContent = `${matches.length} 条结果`;
}

function scheduleRender(value) {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => render(value), 100);
}

function focusResult(offset) {
  const links = [...results.querySelectorAll('.search-result')];
  if (!links.length) return;
  const current = links.indexOf(document.activeElement);
  const index = current === -1
    ? (offset > 0 ? 0 : links.length - 1)
    : Math.min(links.length - 1, Math.max(0, current + offset));
  links[index].focus();
}

function onKeydown(event) {
  if (event.isComposing) return;

  if (event.key === 'Enter' && event.target === input) {
    const first = results.querySelector('.search-result');
    if (first) {
      event.preventDefault();
      first.click();
    }
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusResult(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusResult(-1);
    return;
  }
  if (event.key === 'Escape' && dialog.open) {
    event.preventDefault();
    dialog.close();
  }
}

export function openSearch(query = '') {
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
  input.value = query;
  window.clearTimeout(debounceTimer);
  render(query);
  input.focus();
  input.select();
}

export function initSearch() {
  dialog = document.getElementById('search-dialog');
  input = document.getElementById('search-input');
  results = document.getElementById('search-results');
  count = document.getElementById('search-count');
  if (!dialog || !input || !results || !count) return;

  input.addEventListener('input', () => scheduleRender(input.value));
  input.addEventListener('keydown', onKeydown);
  results.addEventListener('keydown', onKeydown);

  dialog.querySelector('[data-close-search]')?.addEventListener('click', () => dialog.close());

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-open-search]');
    if (trigger) {
      event.preventDefault();
      openSearch('');
      return;
    }
    const term = event.target.closest('[data-search]');
    if (term) {
      event.preventDefault();
      openSearch(term.dataset.search || '');
    }
  });

  document.addEventListener('keydown', (event) => {
    const tag = event.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      || event.target.isContentEditable;

    if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      openSearch('');
      return;
    }
    if (event.key === '/' && !typing && !dialog.open) {
      event.preventDefault();
      openSearch('');
    }
  });
}
