/**
 * [INPUT]: 依赖 data.js 的 formatDateParts / performanceTitle 与 md.js 的 escapeHtml；由 app.js 传入未来演出。
 * [OUTPUT]: 导出 buildBoardPages 与 mountBoard。前者把演出记录切成每页 12 行；
 *           后者渲染首屏出发屏，驱动逐字翻牌、分组循环、自动播放与手动控制。
 * [POS]: 首页首屏的唯一渲染器。它不读取数据文件，只消费 app.js 已汇合的演出。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

import { ensembleText, formatDateParts, performanceTitle } from './data.js';
import { escapeHtml as esc } from './md.js';

const ROWS_PER_PAGE = 12;
const AUTO_INTERVAL = 10000;

/* 列宽以“一张牌”为单位。修改这里，行内 --cells 与根级 --cell-divisor 自动跟随。 */
const FIELDS = [
  { key: 'date', group: 'meta', cells: 4, label: '日期', en: 'Date' },
  { key: 'title', group: 'title', cells: 25, label: '演出', en: 'Program' },
  { key: 'ensemble', group: 'place', cells: 11, label: '乐团', en: 'Ensemble' },
  { key: 'venue', group: 'place', cells: 10, label: '场馆', en: 'Venue' },
];

const LINE_GROUPS = ['meta', 'title', 'place'];

const FIELD_BY_KEY = new Map(FIELDS.map((field) => [field.key, field]));
const FIELD_GAP_RATIO = 0.45;
const MOBILE_GAP_RATIO = 0.3;
const TOTAL_CELLS = FIELDS.reduce((sum, field) => sum + field.cells, 0);

const MOBILE_CELLS = Math.max(...LINE_GROUPS.map((group) => {
  const fields = FIELDS.filter((field) => field.group === group);
  const cells = fields.reduce((sum, field) => sum + field.cells, 0);
  return cells + Math.max(0, fields.length - 1) * MOBILE_GAP_RATIO;
}));

/* 翻动过程中闪现的字符池。只取与古典音乐和城市有关的字，避免出现无关符号。 */
const SCRAMBLE = [
  ...'即将上演古典音乐交响曲钢琴小提琴大提琴独奏室内乐歌剧合唱管弦乐国家大剧院音乐厅维也纳柏林巴黎伦敦北京上海广州',
  ...'0123456789',
  ...':：·/-—',
];

/* 数据 */

/**
 * 把按时间排好的演出切成固定 12 行的组。最后一组不足 12 行时，页面用空白牌补齐。
 * 返回值是纯视图模型，不引用原始 JSON，方便日后替换为后台接口。
 */
export function buildBoardPages(upcoming) {
  const rows = (Array.isArray(upcoming) ? upcoming : []).map(toBoardRow);
  const pages = [];

  for (let index = 0; index < rows.length; index += ROWS_PER_PAGE) {
    pages.push(rows.slice(index, index + ROWS_PER_PAGE));
  }

  return pages.length ? pages : [[]];
}

function toBoardRow(event) {
  const date = formatDateParts(event.date);
  const dateText = date.month ? `${date.month}${date.day}` : '待定';
  const title = performanceTitle(event);
  const ensemble = ensembleText(event) || '—';
  const venue = event.venue || '待定';

  return {
    rawDate: event.date || '',
    date: dateText,
    title,
    ensemble,
    venue,
    href: `#/event/${encodeURIComponent(event.id)}`,
    label: `${dateText} ${title}，${ensemble === '—' ? '无乐团' : ensemble}，${venue}`,
  };
}

function fieldChars(row, field) {
  if (!row) return [];
  /* 翻牌格只放可见字符：空格不单独占牌，避免标题、乐团与场馆中间出现空档。 */
  const chars = [...String(row[field.key] ?? '').replace(/\s+/g, '')];
  if (chars.length > field.cells) return [...chars.slice(0, field.cells - 1), '…'];
  return chars;
}

/* 标记 */

function fieldMarkup(field, row) {
  const chars = fieldChars(row, field);
  let cells = '';

  for (let index = 0; index < field.cells; index += 1) {
    const char = chars[index] || '';
    cells += `<span class="flap${char ? '' : ' flap--blank'}"><span class="flap-char">${esc(char)}</span></span>`;
  }

  return `<span class="board-field board-field--${field.key}" style="--cells:${field.cells}">${cells}</span>`;
}

function lineMarkup(name, keys, row) {
  const fields = keys.map((key) => fieldMarkup(FIELD_BY_KEY.get(key), row)).join('');
  return `<span class="board-line board-line--${name}" aria-hidden="true">${fields}</span>`;
}

function rowMarkup(rowIndex) {
  const lines = LINE_GROUPS.map((group) => {
    const keys = FIELDS.filter((field) => field.group === group).map((field) => field.key);
    return lineMarkup(group, keys, null);
  }).join('');

  return `
    <a class="board-row board-row--empty" data-row="${rowIndex}" aria-hidden="true">
      ${lines}
    </a>
  `;
}

function boardMarkup(total, demo) {
  const header = FIELDS.map((field) => `
    <span class="board-col board-col--${field.key}" style="--cells:${field.cells}">
      <span>${esc(field.label)}</span><em>${esc(field.en)}</em>
    </span>
  `).join('');

  return `
    <div class="board-frame">
      <div class="board-top">
        <p class="board-brand">
          <span class="board-brand-mark" aria-hidden="true"><img src="assets/logo.svg" alt=""></span>
        </p>
        <p class="board-clock"><b data-clock>--:--</b> 本地时间</p>
      </div>

      <div class="board-display">
        <div class="board-title">
          <div>
            <p class="board-kicker">Musica / Departures</p>
            <h1>即将上演</h1>
          </div>
          <p class="board-range">
            <span data-range>—</span>
            <span data-status>自动翻牌 · ${AUTO_INTERVAL / 1000} 秒</span>
          </p>
        </div>

        <div class="board-table">
          <div class="board-columns" aria-hidden="true">${header}</div>

          <div class="board-rows" data-rows>
            ${Array.from({ length: ROWS_PER_PAGE }, (_, index) => rowMarkup(index)).join('')}
          </div>
        </div>
      </div>

      <div class="board-foot">
        <div class="board-controls">
          <button class="board-btn" type="button" data-board="prev" aria-label="上一组演出">← 上一组</button>
          <button class="board-btn" type="button" data-board="play" aria-pressed="false">暂停</button>
          <button class="board-btn" type="button" data-board="next" aria-label="下一组演出">下一组 →</button>
          <p class="board-page" data-page aria-label="当前数据组">${String(1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</p>
        </div>
        <div class="board-progress" aria-hidden="true"><span data-progress></span></div>
        <p class="board-note">
          <span class="board-dot" aria-hidden="true"></span>
          ${demo ? '示例数据 · 非真实票务信息 · ' : '演出信息来自公开渠道 · '}点击任一行查看演出
        </p>
      </div>
    </div>
  `;
}

/* 播放 */

export function mountBoard(root, pages, options = {}) {
  const interval = Number(options.interval) || AUTO_INTERVAL;
  const demo = Boolean(options.demo);
  const total = pages.length;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  root.hidden = false;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', '演出公告');
  root.style.setProperty('--cell-divisor', String(TOTAL_CELLS + (FIELDS.length - 1) * FIELD_GAP_RATIO));
  root.style.setProperty('--field-gap-ratio', String(FIELD_GAP_RATIO));
  root.style.setProperty('--mobile-cells', String(MOBILE_CELLS));
  root.style.setProperty('--board-rows', String(ROWS_PER_PAGE));
  root.innerHTML = boardMarkup(total, demo);

  const rowEls = [...root.querySelectorAll('[data-row]')];
  const pageEl = root.querySelector('[data-page]');
  const rangeEl = root.querySelector('[data-range]');
  const statusEl = root.querySelector('[data-status]');
  const clockEl = root.querySelector('[data-clock]');
  const progressEl = root.querySelector('[data-progress]');
  const prevBtn = root.querySelector('[data-board="prev"]');
  const nextBtn = root.querySelector('[data-board="next"]');
  const playBtn = root.querySelector('[data-board="play"]');

  const cells = rowEls.map((rowEl) => {
    const byField = new Map();

    for (const field of FIELDS) {
      const fieldEl = rowEl.querySelector(`.board-field--${field.key}`);
      byField.set(field.key, [...fieldEl.querySelectorAll('.flap')].map((el) => {
        const charEl = el.firstElementChild;
        return {
          el,
          charEl,
          current: charEl.textContent,
          parity: 0,
        };
      }));
    }

    return byField;
  });

  let index = 0;
  let paused = false;
  let timer = 0;
  let bootTimer = 0;
  let clockTimer = 0;
  let raf = 0;
  let active = null;

  if (total < 2) {
    for (const button of [prevBtn, nextBtn, playBtn]) {
      if (button) button.disabled = true;
    }
    if (progressEl) progressEl.style.display = 'none';
    statusEl.textContent = pages.some((page) => page.length) ? '共 1 组' : '暂无演出';
  }

  prevBtn?.addEventListener('click', () => step(-1));
  nextBtn?.addEventListener('click', () => step(1));
  playBtn?.addEventListener('click', () => setPaused(!paused));
  document.addEventListener('visibilitychange', onVisibility);

  updateClock();
  clockTimer = window.setInterval(updateClock, 30000);
  bootTimer = window.setTimeout(() => renderPage(0), reducedMotion ? 0 : 140);

  return { destroy };

  /* 页面切换 */

  function step(delta) {
    if (total < 2) return;
    const next = (index + delta + total) % total;
    renderPage(next);
  }

  function renderPage(nextIndex, instant = reducedMotion) {
    const page = pages[nextIndex] || [];
    index = nextIndex;

    applyRowMeta(page);
    pageEl.textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    rangeEl.textContent = pageRange(page);
    turn(page, instant);
    restartProgress();
    schedule();
  }

  function applyRowMeta(page) {
    rowEls.forEach((el, rowIndex) => {
      const row = page[rowIndex] || null;

      if (row) {
        el.setAttribute('href', row.href);
        el.setAttribute('aria-label', row.label);
        el.removeAttribute('aria-hidden');
        el.classList.remove('board-row--empty');
      } else {
        el.removeAttribute('href');
        el.setAttribute('aria-hidden', 'true');
        el.classList.add('board-row--empty');
      }
    });
  }

  function pageRange(page) {
    const dates = page.map((row) => row.rawDate).filter(Boolean).sort();
    if (!dates.length) return '暂无演出';

    const first = dates[0].slice(0, 7).replace('-', '.');
    const last = dates[dates.length - 1].slice(0, 7).replace('-', '.');
    return first === last ? first : `${first} — ${last}`;
  }

  /* 翻牌 */

  function turn(page, instant) {
    cancelAnimationFrame(raf);
    active = null;

    const now = performance.now();
    let endAt = now;

    if (instant) {
      for (let rowIndex = 0; rowIndex < ROWS_PER_PAGE; rowIndex += 1) {
        const row = page[rowIndex] || null;
        paintRowInstant(rowIndex, row);
      }
      return;
    }

    const jobs = [];

    for (let rowIndex = 0; rowIndex < ROWS_PER_PAGE; rowIndex += 1) {
      const row = page[rowIndex] || null;
      let column = 0;

      for (const field of FIELDS) {
        const chars = fieldChars(row, field);
        const fieldCells = cells[rowIndex].get(field.key);

        for (let slot = 0; slot < field.cells; slot += 1) {
          const target = chars[slot] || '';
          const cell = fieldCells[slot];
          column += 1;

          if (!cell || cell.current === target) continue;

          const delay = rowIndex * 45 + column * 5 + Math.random() * 30;
          const stepMs = 55 + Math.random() * 20;
          const steps = 4 + Math.floor(Math.random() * 4);
          const settleAt = now + delay + steps * stepMs;

          jobs.push({
            cell,
            target,
            start: now + delay,
            settleAt,
            stepMs,
            steps,
            nextStep: 0,
            done: false,
          });

          if (settleAt > endAt) endAt = settleAt;
        }
      }
    }

    if (!jobs.length) return;

    active = jobs;
    raf = requestAnimationFrame(frame);

    function frame(time) {
      for (const job of active) {
        if (job.done || time < job.start) continue;

        if (time < job.settleAt) {
          const stepIndex = Math.min(job.steps, Math.floor((time - job.start) / job.stepMs));
          while (job.nextStep < stepIndex) {
            job.nextStep += 1;
            paintScramble(job.cell, randomChar(job.cell.current, job.target));
          }
        } else {
          paintFinal(job.cell, job.target);
          job.done = true;
        }
      }

      if (time < endAt + 180) {
        raf = requestAnimationFrame(frame);
      } else {
        active = null;
        raf = 0;
      }
    }
  }

  function paintRowInstant(rowIndex, row) {
    for (const field of FIELDS) {
      const chars = fieldChars(row, field);
      const fieldCells = cells[rowIndex].get(field.key);

      for (let slot = 0; slot < field.cells; slot += 1) {
        const cell = fieldCells[slot];
        if (cell) paintInstant(cell, chars[slot] || '');
      }
    }
  }

  function paintInstant(cell, char) {
    cell.current = char;
    cell.charEl.textContent = char;
    cell.el.classList.toggle('flap--blank', char === '');
    cell.el.classList.remove('flip-a', 'flip-b', 'flip-final');
  }

  function paintScramble(cell, char) {
    cell.current = char;
    cell.charEl.textContent = char;
    cell.el.classList.remove('flap--blank', 'flip-a', 'flip-b', 'flip-final');
    cell.parity = cell.parity ? 0 : 1;
    cell.el.classList.add(cell.parity ? 'flip-a' : 'flip-b');
  }

  function paintFinal(cell, char) {
    cell.current = char;
    cell.charEl.textContent = char;
    cell.el.classList.toggle('flap--blank', char === '');
    cell.el.classList.remove('flip-a', 'flip-b');
    cell.el.classList.add('flip-final');
  }

  function randomChar(previous, target) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const char = SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)];
      if (char !== previous && char !== target) return char;
    }
    return SCRAMBLE[0];
  }

  /* 自动播放 */

  function schedule() {
    window.clearTimeout(timer);
    if (paused || total < 2 || document.hidden) return;
    timer = window.setTimeout(() => renderPage((index + 1) % total), interval);
  }

  function setPaused(next) {
    paused = next;
    root.classList.toggle('is-paused', paused);
    playBtn.textContent = paused ? '继续' : '暂停';
    playBtn.setAttribute('aria-pressed', String(paused));
    statusEl.textContent = paused ? '已暂停' : `自动翻牌 · ${interval / 1000} 秒`;

    if (paused) {
      window.clearTimeout(timer);
      if (progressEl) progressEl.style.animationPlayState = 'paused';
    } else {
      restartProgress();
      schedule();
    }
  }

  function restartProgress() {
    if (!progressEl || total < 2) return;
    progressEl.style.animation = 'none';
    void progressEl.offsetWidth;
    progressEl.style.animation = `board-countdown ${interval}ms linear forwards`;
    progressEl.style.animationPlayState = paused ? 'paused' : 'running';
  }

  function onVisibility() {
    if (document.hidden) {
      window.clearTimeout(timer);
      return;
    }
    if (paused) return;
    restartProgress();
    schedule();
  }

  function updateClock() {
    const now = new Date();
    clockEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  function destroy() {
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    window.clearTimeout(bootTimer);
    window.clearInterval(clockTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    active = null;
    root.replaceChildren();
    root.removeAttribute('role');
    root.removeAttribute('aria-label');
    root.style.removeProperty('--cell-divisor');
    root.style.removeProperty('--field-gap-ratio');
    root.style.removeProperty('--mobile-cells');
    root.style.removeProperty('--board-rows');
    root.classList.remove('is-paused');
    root.hidden = true;
  }
}
