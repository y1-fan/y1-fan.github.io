/**
 * [INPUT]: 依赖 data.js 产出的 { letter, items, summary } 分组；依赖 md.js 转义。
 * [OUTPUT]: 导出 alphabetIndex(sections, renderBody) 与 initAlphabetIndex()。
 * [POS]: 曲目、乐团、场馆三类索引共用的 A–Z 分区与跳转条。
 *        它只排版分组，不取数，也不决定分组规则。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

import { escapeHtml as esc } from './md.js';

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

const sectionId = (letter) => (letter === '#' ? 'alpha-other' : `alpha-${letter}`);

export function alphabetIndex(sections, renderBody) {
  if (!sections.length) return '<p class="empty">还没有条目。</p>';

  const present = new Set(sections.map(({ letter }) => letter));
  const letters = present.has('#') ? [...LETTERS, '#'] : LETTERS;

  return `
    <nav class="alpha-nav" aria-label="字母索引">
      ${letters.map((letter) => (present.has(letter)
        ? `<button class="alpha-chip" type="button" data-alpha-target="${esc(sectionId(letter))}">${esc(letter)}</button>`
        : `<span class="alpha-chip is-empty" aria-hidden="true">${esc(letter)}</span>`)).join('')}
    </nav>

    <div class="alpha-sections">
      ${sections.map((section) => {
        const id = sectionId(section.letter);
        return `
          <section class="alpha-section" id="${esc(id)}" aria-labelledby="${esc(id)}-head">
            <div class="alpha-head">
              <h2 id="${esc(id)}-head">${esc(section.letter)}</h2>
              ${section.summary ? `<p>${esc(section.summary)}</p>` : ''}
            </div>
            <div class="alpha-body">
              ${renderBody(section)}
            </div>
          </section>
        `;
      }).join('')}
    </div>
  `;
}

export function initAlphabetIndex() {
  document.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-alpha-target]');
    if (!chip) return;
    document.getElementById(chip.dataset.alphaTarget)?.scrollIntoView({ block: 'start' });
  });
}
