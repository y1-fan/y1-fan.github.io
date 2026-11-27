/**
 * [INPUT]: 无外部依赖。只接受本地 Markdown 文本。
 * [OUTPUT]: 导出 escapeHtml()、renderInline()、renderMarkdown()。
 * [POS]: 页面正文的渲染器。app.js 调用 renderMarkdown，构建脚本复用 escapeHtml。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 *
 * 支持的语法：ATX 标题、段落、单层有序/无序列表、引用、围栏代码、
 * 表格、分隔线、粗体、斜体、删除线、行内代码、链接、图片、[[wiki 链接]]。
 * 原始 HTML 一律转义；不执行脚本。
 */

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function isCJK(ch) {
  return /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(ch);
}

function safeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(value)) return value;
  return '';
}

/** 行内语法。生成的安全标签先存入 token，避免强调语法改写到属性里。 */
export function renderInline(input) {
  const tokens = [];
  const stash = (html) => {
    tokens.push(html);
    return `\u0000${tokens.length - 1}\u0000`;
  };

  let text = String(input ?? '');

  text = text.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`));

  text = text.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, alt, src) => {
      const url = safeUrl(src);
      if (!url) return escapeHtml(alt);
      return stash(
        `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`,
      );
    },
  );

  text = text.replace(
    /\[\[([a-z0-9][a-z0-9-]*)(?:\|([^\]]+))?\]\]/g,
    (_, slug, label) => stash(
      `<a href="#/work/${encodeURIComponent(slug)}">${escapeHtml(label || slug)}</a>`,
    ),
  );

  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, label, href, title) => {
      const url = safeUrl(href);
      if (!url) return escapeHtml(label);
      const external = /^https?:/i.test(url);
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return stash(`<a href="${escapeHtml(url)}"${titleAttr}${attrs}>${escapeHtml(label)}</a>`);
    },
  );

  text = escapeHtml(text);

  text = text.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^\n]+?)__/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^\w*])\*([^*\n]+?)\*(?=$|[^\w*])/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^\w_])_([^_\n]+?)_(?=$|[^\w_])/g, '$1<em>$2</em>');
  text = text.replace(/~~([^\n]+?)~~/g, '<del>$1</del>');

  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] ?? '');
}

/** 段落内的软换行：中文之间不插空格，西文之间保留一个空格。 */
function joinParagraph(lines) {
  let merged = '';
  let previousHard = false;

  lines.forEach((line, index) => {
    const hard = / {2,}$/.test(line);
    const clean = line.replace(/\s+$/, '');
    if (index === 0) {
      merged = clean;
    } else if (previousHard) {
      merged += `\n${clean}`;
    } else {
      const left = merged.slice(-1);
      const right = clean.charAt(0);
      merged += isCJK(left) && isCJK(right) ? clean : ` ${clean}`;
    }
    previousHard = hard;
  });

  return merged;
}

function renderParagraph(lines) {
  const text = joinParagraph(lines);
  return `<p>${renderInline(text).replace(/\n/g, '<br>')}</p>`;
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const FENCE = /^\s{0,3}(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const HR = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const QUOTE = /^\s{0,3}>\s?/;

function isTableStart(lines, index) {
  if (index + 1 >= lines.length) return false;
  if (!lines[index].includes('|')) return false;
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function isBlockStart(lines, index) {
  const line = lines[index];
  if (!line.trim()) return true;
  if (FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  if (LIST_ITEM.test(line)) return true;
  return isTableStart(lines, index);
}

function splitRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
}

function renderTable(lines, start) {
  const header = splitRow(lines[start]);
  const alignments = splitRow(lines[start + 1]).map((cell) => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
    if (cell.endsWith(':')) return 'right';
    if (cell.startsWith(':')) return 'left';
    return '';
  });

  const rows = [];
  let index = start + 2;
  while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
    rows.push(splitRow(lines[index]));
    index += 1;
  }

  const cell = (tag, text, column) => {
    const align = alignments[column] ? ` class="align-${alignments[column]}"` : '';
    return `<${tag}${align}>${renderInline(text ?? '')}</${tag}>`;
  };

  const head = header.map((text, column) => cell('th', text, column)).join('');
  const body = rows
    .map((row) => `<tr>${header.map((_, column) => cell('td', row[column], column)).join('')}</tr>`)
    .join('');

  return {
    html: `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    next: index,
  };
}

function renderList(lines, start) {
  let html = '';
  let currentType = '';
  let index = start;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      if (index + 1 < lines.length && LIST_ITEM.test(lines[index + 1])) {
        index += 1;
        continue;
      }
      break;
    }

    const match = LIST_ITEM.exec(line);
    if (!match) {
      if (currentType && /^\s{2,}\S/.test(line) && html.endsWith('</li>')) {
        html = `${html.slice(0, -5)} ${renderInline(line.trim())}</li>`;
        index += 1;
        continue;
      }
      break;
    }

    const type = /\d/.test(match[2]) ? 'ol' : 'ul';
    if (type !== currentType) {
      if (currentType) html += `</${currentType}>`;
      html += `<${type}>`;
      currentType = type;
    }

    html += `<li>${renderInline(match[3])}</li>`;
    index += 1;
  }

  if (currentType) html += `</${currentType}>`;
  return { html, next: index };
}

/**
 * 渲染整段 Markdown。
 * headingOffset 用于把正文的 h1 降级，避免与页面标题争夺层级。
 */
export function renderMarkdown(source, options = {}) {
  const headingOffset = Number(options.headingOffset) || 0;
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const language = fence[2];
      const code = [];
      index += 1;
      while (index < lines.length) {
        const closing = FENCE.exec(lines[index]);
        if (closing && closing[1][0] === marker) {
          index += 1;
          break;
        }
        code.push(lines[index]);
        index += 1;
      }
      const className = language ? ` class="language-${escapeHtml(language)}"` : '';
      output.push(`<pre><code${className}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length + headingOffset);
      const text = heading[2].replace(/\s+#+\s*$/, '').trim();
      output.push(`<h${level}>${renderInline(text)}</h${level}>`);
      index += 1;
      continue;
    }

    if (HR.test(line)) {
      output.push('<hr>');
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted = [];
      while (index < lines.length) {
        if (QUOTE.test(lines[index])) {
          quoted.push(lines[index].replace(QUOTE, ''));
          index += 1;
        } else if (!lines[index].trim() && index + 1 < lines.length && QUOTE.test(lines[index + 1])) {
          quoted.push('');
          index += 1;
        } else {
          break;
        }
      }
      output.push(`<blockquote>${renderMarkdown(quoted.join('\n'), { headingOffset })}</blockquote>`);
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = renderTable(lines, index);
      output.push(table.html);
      index = table.next;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const list = renderList(lines, index);
      output.push(list.html);
      index = list.next;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (paragraph.length) output.push(renderParagraph(paragraph));
  }

  return output.join('\n');
}
