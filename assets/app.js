/**
 * [INPUT]: 依赖 md.js 渲染正文，data.js 读取索引与演出，alphabet-index.js 渲染 A–Z 分区，
 *          ai-view.js 渲染 AI 入库页，search.js 提供搜索浮层，board.js 渲染首页首屏出发屏，
 *          mode.js 判断本地编辑版 / 静态发布版并输出管理按钮。
 * [OUTPUT]: 启动应用，按 hash 路由渲染首页（出发屏 + 演出日历）、曲目、作品页、
 *           乐团与场馆页、AI 入库页，以及错误页。静态版不渲染 AI 页与任何写入口。
 * [POS]: 唯一的视图入口。它把“百科条目”和“未来演出”在作品页汇合。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

import { escapeHtml as esc, renderMarkdown } from './md.js';
import {
  loadIndex,
  loadEvents,
  loadWork,
  loadPerformance,
  loadHealth,
  getUpcoming,
  getPast,
  eventsForWork,
  formatDateParts,
  formatDateLong,
  formatMonth,
  formatUpdated,
  relativeDay,
  eventPeople,
  ensembleText,
  performanceTitle,
  pinyinCompare,
  groupByPinyinInitial,
  deletePerformance,
  deleteWork,
  deleteEnsemble,
  deleteVenue,
  clearDataCache,
} from './data.js';
import { initSearch } from './search.js';
import { buildBoardPages, mountBoard } from './board.js';
import { alphabetIndex, initAlphabetIndex } from './alphabet-index.js';
import { renderEnsemble, renderEnsembles, renderVenue, renderVenues } from './entity-views.js';
import { STATIC_MODE, adminCreate, adminDelete, adminEdit } from './mode.js';

const main = document.getElementById('main');
const board = document.getElementById('board');
const boardBootHTML = board ? board.innerHTML : '';
const encode = (value) => encodeURIComponent(String(value || ''));

let routeToken = 0;
let boardController = null;

init();

async function init() {
  initSearch();
  if (!STATIC_MODE) {
    const { initEditor } = await import('./editor.js');
    initEditor();
  }
  initChrome();
  initWriteMode();
  initAlphabetIndex();
  initDeleteActions();

  window.addEventListener('hashchange', () => {
    window.scrollTo(0, 0);
    renderRoute();
  });

  window.addEventListener('musica:saved', (event) => {
    clearDataCache();
    const path = event.detail?.path;
    if (path && path !== window.location.hash) {
      window.location.hash = path;
    } else {
      renderRoute();
    }
  });

  await renderRoute();
}

function initWriteMode() {
  if (STATIC_MODE) {
    document.body.dataset.canWrite = '0';
    return;
  }

  loadHealth()
    .then((data) => {
      document.body.dataset.canWrite = data.write === 'none' ? '0' : '1';
      if (data.write === 'token') document.body.dataset.writeMode = 'token';
    })
    .catch(() => {
      document.body.dataset.canWrite = '0';
    });
}

function initChrome() {
  const year = document.getElementById('foot-year');
  if (year) year.textContent = String(new Date().getFullYear());
}

function initDeleteActions() {
  if (STATIC_MODE) return;

  const actions = {
    performance: {
      message: '确定删除这场演出？节目单关联也会一并移除。',
      path: '#/',
      run: (key) => deletePerformance(key),
    },
    work: {
      message: '确定删除这部曲目？如果仍被演出引用，将无法删除。',
      path: '#/works',
      run: (key) => deleteWork(key),
    },
    ensemble: {
      message: '确定删除这个乐团？如果仍被演出引用，将无法删除。',
      path: '#/ensembles',
      run: (key) => deleteEnsemble(key),
    },
    venue: {
      message: '确定删除这个场馆？如果仍被演出引用，将无法删除。',
      path: '#/venues',
      run: (key) => deleteVenue(key),
    },
  };

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete]');
    if (!button) return;
    event.preventDefault();

    const kind = button.dataset.delete;
    const key = button.dataset.key;
    const action = actions[kind];
    if (!action || !key) return;
    if (!ensureAdminToken()) return;
    if (!window.confirm(action.message)) return;

    button.disabled = true;
    try {
      await action.run(key);
      window.dispatchEvent(new CustomEvent('musica:saved', {
        detail: { kind, path: action.path },
      }));
    } catch (error) {
      button.disabled = false;
      window.alert(error.message || '删除失败');
    }
  });
}

function ensureAdminToken() {
  if (document.body.dataset.writeMode !== 'token') return true;

  try {
    if (sessionStorage.getItem('musica.token')) return true;
  } catch {
    return true;
  }

  const token = window.prompt('请输入管理 token');
  if (!token.trim()) return false;
  try {
    sessionStorage.setItem('musica.token', token.trim());
  } catch {
    return false;
  }
  return true;
}

function hideBoard() {
  if (boardController) {
    boardController.destroy();
    boardController = null;
  }
  if (!board) return;
  board.hidden = true;
  board.replaceChildren();
}

function startBoard(upcoming, demo = false) {
  if (!board) return;
  hideBoard();

  board.hidden = false;
  boardController = mountBoard(board, buildBoardPages(upcoming), { demo });
}

function showBoardBoot() {
  if (!board) return;
  if (boardController) {
    boardController.destroy();
    boardController = null;
  }
  board.innerHTML = boardBootHTML;
  board.hidden = false;
}

/* 路由 */

function parseRoute() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const path = raw.split('?')[0];
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

  if (!segments.length) return { name: 'home' };
  if (segments[0] === 'calendar') {
    window.history.replaceState(null, '', '#/');
    return { name: 'home' };
  }
  if (segments[0] === 'works') return { name: 'works' };
  if (segments[0] === 'event' && segments[1]) return { name: 'event', id: segments[1] };
  if (segments[0] === 'ensembles') return { name: 'ensembles' };
  if (segments[0] === 'ensemble' && segments[1]) return { name: 'ensemble', slug: segments[1] };
  if (segments[0] === 'venues') return { name: 'venues' };
  if (segments[0] === 'venue' && segments[1]) return { name: 'venue', slug: segments[1] };
  if (segments[0] === 'history') return { name: 'history' };
  if (segments[0] === 'work' && segments[1]) return { name: 'work', slug: segments[1] };
  if (segments[0] === 'ai') return STATIC_MODE ? { name: 'notfound' } : { name: 'ai' };
  return { name: 'notfound' };
}

function navKey(routeName) {
  if (routeName === 'home' || routeName === 'event') return 'home';
  if (routeName === 'works' || routeName === 'work') return 'works';
  if (routeName === 'ensemble') return 'ensembles';
  if (routeName === 'venue') return 'venues';
  return routeName;
}

function setActiveNav(routeName) {
  const active = navKey(routeName);
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function setPageTitle(title) {
  document.title = title ? `${title} · Musica` : 'Musica · 古典音乐演出与百科';
}

async function renderRoute() {
  const token = ++routeToken;
  const route = parseRoute();
  setActiveNav(route.name);

  if (route.name !== 'home') hideBoard();

  if (route.name === 'notfound') {
    renderNotFound();
    return;
  }

  main.setAttribute('aria-busy', 'true');

  try {
    if (route.name === 'home') await renderHome(token);
    else if (route.name === 'history') await renderHistory(token);
    else if (route.name === 'works') await renderWorks(token);
    else if (route.name === 'event') await renderEvent(route.id, token);
    else if (route.name === 'ensembles') await renderEnsembles(main, setPageTitle);
    else if (route.name === 'ensemble') await renderEnsemble(route.slug, main, setPageTitle);
    else if (route.name === 'venues') await renderVenues(main, setPageTitle);
    else if (route.name === 'venue') await renderVenue(route.slug, main, setPageTitle);
    else if (route.name === 'ai') {
      const { renderAi } = await import('./ai-view.js');
      await renderAi(main, setPageTitle);
    }
    else await renderWork(route.slug, token);
  } catch (error) {
    if (token !== routeToken) return;
    if (error.status === 404 || error.code === 'NOT_FOUND' || error.message === 'NOT_FOUND') {
      renderNotFound();
    } else {
      renderError(error);
    }
  } finally {
    if (token === routeToken) main.removeAttribute('aria-busy');
  }
}

/* 首页：出发屏 + 演出日历 */

async function renderHome(token) {
  showBoardBoot();
  const eventData = await loadEvents();
  if (token !== routeToken) return;

  const events = eventData.events;
  const upcoming = getUpcoming(events);
  const next = upcoming.slice(0, 5);

  setPageTitle('');
  startBoard(upcoming, eventData.demo);
  main.innerHTML = `
    ${tickerMarkup(next, upcoming, eventData.updated)}
    ${calendarMarkup(upcoming, eventData)}
  `;
}

function calendarMarkup(upcoming, eventData) {
  const updated = formatUpdated(eventData.updated);

  return `
    <header class="page-head">
      <p class="kicker"><span>Agenda</span><span>未来演出 / 按时间排列</span></p>
      <h1>演出日历</h1>
      <p class="notice"><span class="demo-dot" aria-hidden="true"></span>${eventData.demo ? '示例数据，非真实票务信息' : '演出信息来自公开渠道'}${updated ? ` · 更新于 ${esc(updated)}` : ''}</p>
    </header>

    ${adminCreate('performance', '新增演出')}

    ${monthSections(upcoming, '暂时没有已公布的演出。')}
  `;
}

/* 历史演出：已结束场次，从旧到新 */

async function renderHistory(token) {
  const eventData = await loadEvents();
  if (token !== routeToken) return;

  const past = getPast(eventData.events).reverse();
  const updated = formatUpdated(eventData.updated);
  setPageTitle('历史');

  main.innerHTML = `
    <header class="page-head">
      <p class="kicker"><span>Archive</span><span>${past.length} 场已结束 / 从旧到新</span></p>
      <h1>历史</h1>
      <p class="notice"><span class="demo-dot" aria-hidden="true"></span>${eventData.demo ? '示例数据，非真实票务信息' : '演出信息来自公开渠道'}${updated ? ` · 更新于 ${esc(updated)}` : ''}</p>
    </header>

    ${monthSections(past, '还没有已结束的演出。')}
  `;
}

/** 首页日历与历史页共用的月份分组；按传入顺序渲染。 */
function monthSections(events, emptyText) {
  if (!events.length) return `<p class="empty">${esc(emptyText)}</p>`;

  const groups = new Map();
  for (const event of events) {
    const month = String(event.date || '').slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(event);
  }

  return [...groups.entries()].map(([month, list]) => `
    <section class="month" aria-labelledby="month-${esc(month)}">
      <h2 id="month-${esc(month)}">${esc(formatMonth(month))}<small>${list.length} 场</small></h2>
      <div class="month-events">${list.map((event) => eventCard(event)).join('')}</div>
    </section>
  `).join('');
}

/* 曲目 */

async function renderWorks(token) {
  const index = await loadIndex();
  if (token !== routeToken) return;

  const works = index.works || [];
  setPageTitle('曲目');
  main.innerHTML = `
    <header class="page-head">
      <p class="kicker"><span>Works</span><span>${works.length} 部作品 / 按作曲家拼音排列</span></p>
      <h1>曲目</h1>
    </header>

    ${adminCreate('work', '新增曲目')}

    <section class="section section--flush" aria-label="曲目">
      ${composerIndex(works)}
    </section>
  `;
}

/* 演出页 */

async function renderEvent(id, token) {
  const { event, updated, demo } = await loadPerformance(id);
  if (token !== routeToken) return;
  if (!event) {
    renderNotFound();
    return;
  }

  const date = formatDateParts(event.date);
  const title = performanceTitle(event);
  const titleParts = title.split(' · ');
  const titleHtml = titleParts.length > 1
    ? `${esc(titleParts[0])}<span class="event-title-second">${esc(titleParts.slice(1).join(' · '))}</span>`
    : esc(title);
  const works = event.workItems || [];
  const updatedText = formatUpdated(updated);
  const venue = event.venue
    ? `<a href="#/venue/${encode(event.venueSlug)}">${esc(event.venue)}</a>`
    : '场馆待定';
  const ensemble = ensembleLinksMarkup(event);
  const people = eventPeople(event, { withEnsemble: false });

  const meta = [
    ['日期', formatDateLong(event.date)],
    ['时间', event.time],
    ['来源', ['seed', 'manual', ''].includes(event.source) ? '' : event.source],
  ].filter(([, value]) => value);

  setPageTitle(title);
  main.innerHTML = `
    <nav class="crumbs" aria-label="面包屑">
      <a href="#/">首页</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${esc(title)}</span>
    </nav>

    <header class="event-head">
      <div class="event-head-date">
        <b>${Number(date.day)}</b>
        <span class="event-head-date-lines">
          <span class="event-head-when">${Number(date.month)} 月 · ${esc(date.weekday)}</span>
          <span class="event-head-year">${esc(date.year)}</span>
        </span>
      </div>

      <div class="event-head-main">
        <p class="kicker"><span>Concert / 演出</span><span>${esc(date.year)}.${esc(date.month)}.${esc(date.day)}${event.time ? ` · ${esc(event.time)}` : ''}</span></p>
        <h1>${titleHtml}</h1>
        <p class="event-head-place">${ensemble ? `${ensemble} · ` : ''}${venue}${event.city ? ` · ${esc(event.city)}` : ''}${event.country ? `，${esc(event.country)}` : ''}</p>
        ${people ? `<p class="event-head-people">${esc(people)}</p>` : ''}
        <p class="notice"><span class="demo-dot" aria-hidden="true"></span>${demo ? '示例数据，非真实票务信息' : '演出信息来自公开渠道'}${updatedText ? ` · 更新于 ${esc(updatedText)}` : ''}</p>
      </div>

      <aside class="work-aside event-aside">
        <p class="micro">
          <span class="signal-square" aria-hidden="true"></span>Concert file / 演出档案
          ${adminEdit('performance', id)}${adminDelete('performance', id)}
        </p>
        <ul class="meta">
          ${meta.map(([label, value]) => `<li><span>${esc(label)}</span>${esc(value)}</li>`).join('')}
        </ul>
        ${event.ticketUrl || event.sourceUrl ? `
          <div class="event-links">
            ${event.ticketUrl ? `<a class="panel hoverable" href="${esc(event.ticketUrl)}" target="_blank" rel="noreferrer">购票信息</a>` : ''}
            ${event.sourceUrl ? `<a class="panel hoverable" href="${esc(event.sourceUrl)}" target="_blank" rel="noreferrer">演出来源</a>` : ''}
          </div>
        ` : ''}
      </aside>
    </header>

    <section class="section program" aria-labelledby="program-title">
      <div class="section-head">
        <h2 id="program-title">节目单</h2>
        <div class="section-meta">
          ${event.note ? `<span>${esc(event.note)}</span>` : ''}
          <span>${works.length} 部作品</span>
          <span>按演出顺序</span>
        </div>
      </div>
      ${works.length
        ? `<ol class="program-list">${programMarkup(works, event)}</ol>`
        : '<p class="empty">节目单待公布。</p>'}
    </section>
  `;
}

function programMarkup(works, event) {
  const items = [];
  works.forEach((work, index) => {
    items.push(programRow(work, index));
    if (event.intermissionAfter === index + 1) items.push(breakRow());
  });
  return items.join('');
}

function breakRow() {
  return '<li class="program-break" aria-label="中场休息">中场休息 <span>Intermission</span></li>';
}

function programRow(work, index) {
  const meta = [work.genre, work.year].filter(Boolean).join(' / ');
  const opus = work.opus ? `<span class="program-opus">${esc(work.opus)}</span>` : '';
  const note = work.note ? `<span class="program-note">${esc(work.note)}</span>` : '';
  return `
    <li>
      <a class="program-row panel hoverable" href="#/work/${encode(work.slug)}">
        <span class="program-num">${String(index + 1).padStart(2, '0')}</span>
        <span class="program-main">
          <span class="program-heading">
            <span class="program-title">${esc(work.title)}</span>
            ${opus}
          </span>
          ${note}
          <span class="program-composer">${esc(work.composer)}</span>
        </span>
        <span class="program-meta">${esc(meta)}</span>
      </a>
    </li>
  `;
}

function tickerMarkup(next, upcoming, updated) {
  const first = next[0];
  const date = first ? formatDateParts(first.date) : null;
  const ensemble = first ? ensembleText(first) : '';
  const items = [
    `${upcoming.length} 场未来演出`,
    first && date
      ? `Next / ${date.year}.${date.month}.${date.day} / ${ensemble || first.venue} / ${first.city || ''}`
      : 'No upcoming concerts',
    `Updated / ${formatUpdated(updated) || '—'}`,
  ];

  return `
    <div class="ticker" aria-hidden="true">
      <div class="ticker-track">
        ${items.map((item) => `<span>${esc(item)}</span>`).join('').repeat(8)}
      </div>
    </div>
  `;
}

function composerIndex(works) {
  if (!works.length) return '<p class="empty">还没有条目。</p>';

  const groups = new Map();
  for (const work of works) {
    if (!groups.has(work.composer)) groups.set(work.composer, []);
    groups.get(work.composer).push(work);
  }

  const composers = [...groups.entries()].sort(([a], [b]) => pinyinCompare(a, b));
  const sections = groupByPinyinInitial(composers, ([composer]) => composer)
    .map((section) => ({
      ...section,
      summary: `${section.items.length} 位作曲家 / ${section.items.reduce((total, [, list]) => total + list.length, 0)} 部作品`,
    }));

  return alphabetIndex(sections, ({ items }) => `
    <div class="index-grid">
      ${items.map(([composer, list]) => `
        <section class="composer-group panel" aria-label="${esc(composer)}">
          <h3 class="composer-head">${esc(composer)}<span>${list.length} 部</span></h3>
          <ul class="work-list">
            ${list.map((work) => `
              <li>
                <a class="work-row" href="#/work/${encodeURIComponent(work.slug)}">
                  <span class="work-main">
                    <span class="work-name">${esc(work.title)}${work.key ? `<em>${esc(work.key)}</em>` : ''}</span>
                    <span class="work-original" lang="en">${esc(work.original || '')}</span>
                  </span>
                  <span class="work-right">${esc([work.opus, work.year, work.genre].filter(Boolean).join(' / '))}</span>
                </a>
              </li>
            `).join('')}
          </ul>
        </section>
      `).join('')}
    </div>
  `);
}

/* 作品页 */

async function renderWork(slug, token) {
  const [index, eventData] = await Promise.all([loadIndex(), loadEvents()]);
  if (token !== routeToken) return;

  const works = index.works || [];
  const summary = works.find((work) => work.slug === slug);
  if (!summary) {
    renderNotFound();
    return;
  }

  const page = await loadWork(slug);
  if (token !== routeToken) return;

  const allEvents = eventData.events;
  const gigs = eventsForWork(allEvents, slug);
  const upcoming = getUpcoming(gigs);
  const past = getPast(gigs);
  const position = works.findIndex((work) => work.slug === slug);
  const previous = position > 0 ? works[position - 1] : null;
  const next = position >= 0 && position < works.length - 1 ? works[position + 1] : null;

  const meta = [
    ['作曲家', page.composer],
    ['时期', page.period],
    ['体裁', page.genre],
    ['作品号', page.opus],
    ['调性', page.key],
    ['创作', page.year],
    ['时长', page.duration],
  ].filter(([, value]) => value);

  const tags = Array.isArray(page.tags) ? page.tags : [];
  const workNumber = String(position + 1).padStart(2, '0');
  const workTotal = String(works.length).padStart(2, '0');

  setPageTitle(`${page.title} · ${page.composer}`);
  main.innerHTML = `
    <nav class="crumbs" aria-label="面包屑">
      <a href="#/works">曲目</a>
      <span aria-hidden="true">/</span>
      <button class="crumb-link" type="button" data-search="${esc(page.composer)}">${esc(page.composer)}</button>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${esc(page.title)}</span>
    </nav>

    <header class="work-head">
      <div class="work-title-block">
        <p class="kicker"><span>Work ${workNumber} / ${workTotal}</span><span>${esc(page.composer)}${page.period ? ` · ${esc(page.period)}` : ''}</span></p>
        <h1>${esc(page.title)}</h1>
        ${page.original ? `<p class="original" lang="en">${esc(page.original)}</p>` : ''}
        ${page.summary ? `<p class="lead">${esc(page.summary)}</p>` : ''}
      </div>

      <aside class="work-aside">
        <p class="micro">
          <span class="signal-square" aria-hidden="true"></span>Work file / 作品档案
          ${adminEdit('work', page.slug)}${adminDelete('work', page.slug)}
        </p>
        ${meta.length ? `<ul class="meta">${meta.map(([label, value]) => `<li><span>${esc(label)}</span>${esc(value)}</li>`).join('')}</ul>` : ''}
        ${tags.length ? `<div class="chips" aria-label="标签">${tags.map((tag) => `<button class="chip panel hoverable" type="button" data-search="${esc(tag)}">${esc(tag)}</button>`).join('')}</div>` : ''}
      </aside>
    </header>

    <div class="work-grid">
      ${renderGigs(upcoming, past, eventData, page.title)}
      <article class="prose">${renderMarkdown(page.body)}</article>
    </div>

    ${previous || next ? `
      <nav class="work-nav" aria-label="相邻条目">
        ${previous ? `<a class="panel hoverable" href="#/work/${encodeURIComponent(previous.slug)}"><span>Prev / 上一条</span>${esc(previous.title)}<em>${esc(previous.composer)}</em></a>` : ''}
        ${next ? `<a class="next panel hoverable" href="#/work/${encodeURIComponent(next.slug)}"><span>Next / 下一条</span>${esc(next.title)}<em>${esc(next.composer)}</em></a>` : ''}
      </nav>
    ` : ''}
  `;
}

function renderGigs(upcoming, past, eventData, title) {
  const demo = Boolean(eventData.demo);
  const updated = formatUpdated(eventData.updated);

  return `
    <aside class="gigs panel hoverable" aria-labelledby="gigs-title">
      <p class="micro gigs-kicker"><span class="signal-square" aria-hidden="true"></span>Live index / 现场</p>
      <div class="gigs-head">
        <h2 id="gigs-title">即将上演</h2>
        ${upcoming.length ? `<span class="count">${upcoming.length} 场</span>` : ''}
      </div>
      <p class="gigs-note">${demo ? '<span class="demo-dot" aria-hidden="true"></span>示例数据 · ' : ''}更新于 ${esc(updated || '—')}</p>
      ${upcoming.length
        ? `<ol class="gigs-list">${upcoming.map((event) => gigRow(event)).join('')}</ol>`
        : `<p class="gigs-empty">暂无已公布的演出。接入演出数据源后，这里会自动显示《${esc(title)}》未来的场次。</p>`}
      ${past.length ? renderPast(past) : ''}
    </aside>
  `;
}

/** 多乐团链接：标题里已经出现的乐团不再重复显示。 */
function ensembleLinksMarkup(event, options = {}) {
  const title = String(options.omitInTitle || '');
  return (event.ensembles || [])
    .filter((item) => item?.name && !(title && title.includes(item.name)))
    .map((item) => (item.slug
      ? `<a href="#/ensemble/${encode(item.slug)}">${esc(item.name)}</a>`
      : esc(item.name)))
    .join(' | ');
}

function gigRow(event) {
  const date = formatDateParts(event.date);
  const title = performanceTitle(event);
  const people = eventPeople(event, { withEnsemble: false });
  const relation = relativeDay(event.date);
  const venue = event.venue
    ? `<a href="#/venue/${encode(event.venueSlug)}">${esc(event.venue)}</a>`
    : '场馆待定';
  const ensemble = ensembleLinksMarkup(event, { omitInTitle: title });
  const place = [
    ensemble,
    `${venue}${event.city ? ` · ${esc(event.city)}` : ''}`,
  ].filter(Boolean).join(' · ');

  return `
    <li class="gig">
      <time class="gig-date" datetime="${esc(event.date)}">
        <b>${Number(date.day)}</b>
        <span>${Number(date.month)} 月 · ${esc(date.weekday)}</span>
        <span class="gig-year">${esc(date.year)}</span>
      </time>
      <div class="gig-body">
        <p class="gig-venue"><a href="#/event/${encode(event.id)}">${esc(title)}</a></p>
        ${place ? `<p class="gig-people">${place}</p>` : ''}
        ${people ? `<p class="gig-note">${esc(people)}</p>` : ''}
        <p class="gig-meta">
          ${event.time ? `<span>${esc(event.time)}</span>` : ''}
          ${relation ? `<span class="rel">${relation}</span>` : ''}
        </p>
      </div>
    </li>
  `;
}

function renderPast(past) {
  const items = past.slice(0, 8).map((event) => {
    const venue = event.venue
      ? `<a href="#/venue/${encode(event.venueSlug)}">${esc(event.venue)}</a>`
      : '场馆待定';
    return `
      <li>
        <span>${esc(formatDateLong(event.date))}</span>
        <a class="past-title" href="#/event/${encode(event.id)}">${esc(performanceTitle(event))}</a>
        <span>${venue}${event.city ? ` · ${esc(event.city)}` : ''}</span>
      </li>
    `;
  }).join('');

  return `
    <details class="past">
      <summary>已结束 · ${past.length} 场</summary>
      <ul>${items}</ul>
    </details>
  `;
}

/* 日历场次卡 */

function eventCard(event) {
  const date = formatDateParts(event.date);
  const title = performanceTitle(event);
  const people = eventPeople(event, { withEnsemble: false });
  const href = `#/event/${encode(event.id)}`;
  const venue = event.venue
    ? `<a href="#/venue/${encode(event.venueSlug)}">${esc(event.venue)}</a>`
    : '场馆待定';
  const ensemble = ensembleLinksMarkup(event, { omitInTitle: title });

  return `
    <article class="event panel hoverable">
      <div class="event-date">
        <b>${Number(date.day)}</b>
        <span>${esc(date.weekday)}</span>
      </div>
      <div class="event-body">
        <p class="event-kicker"></p>
        <h3 class="event-title"><a href="${href}">${esc(title)}</a></h3>
        <p class="event-venue">${venue}${event.city ? ` · ${esc(event.city)}` : ''}${event.country ? `，${esc(event.country)}` : ''}</p>
        ${ensemble || people ? `<p class="event-people">${ensemble}${ensemble && people ? ' · ' : ''}${esc(people)}</p>` : ''}
      </div>
      <div class="event-side">
        ${event.time ? `<span class="event-time">${esc(event.time)}</span>` : ''}
      </div>
    </article>
  `;
}

/* 通用状态 */

function renderNotFound() {
  hideBoard();
  setPageTitle('没有这个条目');
  main.innerHTML = `
    <section class="state panel">
      <p class="kicker">404</p>
      <h1>没有这个条目</h1>
      <p>它可能已被重命名，或者链接有误。</p>
      <a class="button panel hoverable" href="#/">返回首页</a>
    </section>
  `;
}

function renderError(error) {
  hideBoard();
  setPageTitle('加载失败');
  const localHint = STATIC_MODE
    ? '这是只读静态发布版，数据来自 assets/site-data.js。请通过 HTTP 访问（GitHub Pages 或任意静态服务器），不要用 file:// 直接打开。'
    : window.location.protocol === 'file:'
      ? '你正在直接打开本地文件。请在项目目录运行 npm start，然后访问 http://127.0.0.1:8000。'
      : '请确认 Node 服务已启动、SQLite 数据库已生成，并检查浏览器 Network 中的 /api 请求。';

  main.innerHTML = `
    <section class="state panel">
      <p class="kicker">Error</p>
      <h1>内容没有加载成功</h1>
      <p>${esc(localHint)}</p>
      <details class="error-detail">
        <summary>技术信息</summary>
        <pre>${esc(error.message)}</pre>
      </details>
      <button class="button panel hoverable" type="button" data-reload>重新加载</button>
    </section>
  `;

  main.querySelector('[data-reload]')?.addEventListener('click', () => window.location.reload());
}
