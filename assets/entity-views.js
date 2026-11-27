/**
 * [INPUT]: 依赖 data.js 读取乐团/场馆与其演出；依赖 alphabet-index.js 提供 A–Z 分区；依赖 md.js 转义。
 * [OUTPUT]: 导出 renderEnsembles、renderEnsemble、renderVenues、renderVenue 四个视图函数。
 * [POS]: 曲目之外的两种实体页。列表先按名称拼音排序，再按首字母分成 A–Z 区块；
 *        详情按时间列演出。它们只负责排版，不直接 fetch，也不写路由。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

import { escapeHtml as esc } from './md.js';
import { alphabetIndex } from './alphabet-index.js';
import { adminCreate, adminDelete, adminEdit } from './mode.js';
import {
  eventPeople,
  formatDateLong,
  formatDateParts,
  formatUpdated,
  getPast,
  getUpcoming,
  groupByPinyinInitial,
  loadEnsemble,
  loadEnsembles,
  loadVenue,
  loadVenues,
  performanceTitle,
  pinyinCompare,
} from './data.js';

const encode = (value) => encodeURIComponent(String(value || ''));

export async function renderEnsembles(main, setTitle) {
  const { ensembles } = await loadEnsembles();
  setTitle('乐团');

  const sorted = [...ensembles].sort((a, b) => pinyinCompare(a.name, b.name));
  const sections = groupByPinyinInitial(sorted)
    .map((section) => ({ ...section, summary: `${section.items.length} 个乐团` }));

  main.innerHTML = `
    <header class="page-head">
      <p class="kicker"><span>Ensembles</span><span>${sorted.length} 个乐团 / 按拼音排列</span></p>
      <h1>乐团</h1>
    </header>

    ${adminCreate('ensemble', '新增乐团')}

    <section class="section section--flush" aria-label="乐团">
      ${entityIndex(sections, 'ensemble')}
    </section>
  `;
}

export async function renderEnsemble(slug, main, setTitle) {
  const ensemble = await loadEnsemble(slug);
  setTitle(ensemble.name);

  const upcoming = getUpcoming(ensemble.performances || []);
  const past = getPast(ensemble.performances || []);

  main.innerHTML = `
    <nav class="crumbs" aria-label="面包屑">
      <a href="#/ensembles">乐团</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${esc(ensemble.name)}</span>
    </nav>

    <header class="entity-head">
      <div class="entity-title">
        <p class="kicker"><span>Ensemble / 乐团</span><span>${upcoming.length} 场即将上演</span></p>
        <h1>${esc(ensemble.name)}</h1>
        ${ensemble.nameEn ? `<p class="original" lang="en">${esc(ensemble.nameEn)}</p>` : ''}
        <p class="lead">${esc(ensemble.description || '暂无简介。')}</p>
        <p class="notice"><span class="demo-dot" aria-hidden="true"></span>${ensemble.demo ? '示例数据，非真实票务信息' : '信息来自公开渠道'}${ensemble.updated ? ` · 更新于 ${esc(formatUpdated(ensemble.updated))}` : ''}</p>
      </div>

      <aside class="work-aside">
        <p class="micro">
          <span class="signal-square" aria-hidden="true"></span>Ensemble file / 乐团档案
          ${adminEdit('ensemble', ensemble.slug)}${adminDelete('ensemble', ensemble.slug)}
        </p>
        ${entityMeta([
          ['城市', ensemble.city],
          ['国家', ensemble.country],
          ['网站', ensemble.website, 'link'],
          ['来源', ensemble.sourceUrl, 'link'],
        ])}
      </aside>
    </header>

    ${entityPerformances(upcoming, past, 'ensemble')}
  `;
}

export async function renderVenues(main, setTitle) {
  const { venues } = await loadVenues();
  setTitle('场馆');

  const sorted = [...venues].sort((a, b) => pinyinCompare(a.name, b.name));
  const sections = groupByPinyinInitial(sorted)
    .map((section) => ({ ...section, summary: `${section.items.length} 个场馆` }));

  main.innerHTML = `
    <header class="page-head">
      <p class="kicker"><span>Venues</span><span>${sorted.length} 个场馆 / 按拼音排列</span></p>
      <h1>场馆</h1>
    </header>

    ${adminCreate('venue', '新增场馆')}

    <section class="section section--flush" aria-label="场馆">
      ${entityIndex(sections, 'venue')}
    </section>
  `;
}

export async function renderVenue(slug, main, setTitle) {
  const venue = await loadVenue(slug);
  setTitle(venue.name);

  const upcoming = getUpcoming(venue.performances || []);
  const past = getPast(venue.performances || []);

  main.innerHTML = `
    <nav class="crumbs" aria-label="面包屑">
      <a href="#/venues">场馆</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${esc(venue.name)}</span>
    </nav>

    <header class="entity-head">
      <div class="entity-title">
        <p class="kicker"><span>Venue / 场馆</span><span>${upcoming.length} 场即将上演</span></p>
        <h1>${esc(venue.name)}</h1>
        ${venue.nameEn ? `<p class="original" lang="en">${esc(venue.nameEn)}</p>` : ''}
        <p class="lead">${esc(venue.description || '暂无简介。')}</p>
        <p class="notice"><span class="demo-dot" aria-hidden="true"></span>${venue.demo ? '示例数据，非真实票务信息' : '信息来自公开渠道'}${venue.updated ? ` · 更新于 ${esc(formatUpdated(venue.updated))}` : ''}</p>
      </div>

      <aside class="work-aside">
        <p class="micro">
          <span class="signal-square" aria-hidden="true"></span>Venue file / 场馆档案
          ${adminEdit('venue', venue.slug)}${adminDelete('venue', venue.slug)}
        </p>
        ${entityMeta([
          ['城市', venue.city],
          ['国家', venue.country],
          ['地址', venue.address],
          ['网站', venue.website, 'link'],
          ['来源', venue.sourceUrl, 'link'],
        ])}
      </aside>
    </header>

    ${entityPerformances(upcoming, past, 'venue')}
  `;
}

function entityIndex(sections, kind) {
  return alphabetIndex(sections, ({ items }) => `
    <div class="entity-group panel">
      <ul class="entity-list">
        ${items.map((item) => {
          const place = [item.city, item.country].filter(Boolean).join(' · ');
          const count = Number(item.upcomingCount || 0);
          const meta = [place, count ? `${count} 场` : ''].filter(Boolean).join(' · ');
          return `
            <li>
              <a class="entity-row" href="#/${kind}/${encode(item.slug)}">
                <span class="entity-row-main">
                  <span class="entity-row-name">${esc(item.name)}</span>
                  ${item.nameEn ? `<span class="entity-row-en" lang="en">${esc(item.nameEn)}</span>` : ''}
                </span>
                ${meta ? `<span class="entity-row-meta">${esc(meta)}</span>` : ''}
              </a>
            </li>
          `;
        }).join('')}
      </ul>
    </div>
  `);
}

function entityMeta(rows) {
  const items = rows.filter(([, value]) => value);
  if (!items.length) return '<p class="entity-meta-empty">暂无档案信息。</p>';

  return `<ul class="meta">${items.map(([label, value, type]) => {
    const content = type === 'link'
      ? `<a href="${esc(value)}" target="_blank" rel="noreferrer">${esc(hostOf(value))}</a>`
      : esc(value);
    return `<li><span>${esc(label)}</span>${content}</li>`;
  }).join('')}</ul>`;
}

function hostOf(url) {
  try {
    return new URL(url, document.baseURI).host || url;
  } catch {
    return url;
  }
}

function entityPerformances(upcoming, past, perspective) {
  const rows = upcoming.map((event) => performanceRow(event, perspective)).join('');
  const pastItems = past.slice(0, 10).map((event) => `
    <li>
      <span>${esc(formatDateLong(event.date))}</span>
      <a href="#/event/${encode(event.id)}">${esc(performanceTitle(event))}</a>
    </li>
  `).join('');

  return `
    <section class="section entity-performances" aria-labelledby="entity-upcoming">
      <div class="section-head">
        <h2 id="entity-upcoming">即将上演</h2>
        <div class="section-meta"><span>${upcoming.length} upcoming</span><span>按时间排序</span></div>
      </div>
      ${rows ? `<ol class="entity-events">${rows}</ol>` : '<p class="empty">暂无已公布的演出。</p>'}
      ${past.length ? `
        <details class="past entity-past">
          <summary>已结束 · ${past.length} 场</summary>
          <ul>${pastItems}</ul>
        </details>
      ` : ''}
    </section>
  `;
}

function performanceRow(event, perspective) {
  const date = formatDateParts(event.date);
  const title = performanceTitle(event);

  const venue = event.venue
    ? `<a href="#/venue/${encode(event.venueSlug)}">${esc(event.venue)}</a>`
    : '—';
  const ensemble = event.ensemble
    ? `<a href="#/ensemble/${encode(event.ensembleSlug)}">${esc(event.ensemble)}</a>`
    : '—';
  const place = perspective === 'ensemble'
    ? `${venue}${event.city ? ` · ${esc(event.city)}` : ''}`
    : ensemble;
  const people = eventPeople(event, { withEnsemble: false });

  return `
    <li class="entity-event panel">
      <time class="entity-date" datetime="${esc(event.date)}">
        <b>${Number(date.day)}</b>
        <span>${Number(date.month)} 月 · ${esc(date.weekday)}</span>
        <span class="entity-year">${esc(date.year)}</span>
      </time>
      <div class="entity-event-body">
        <p class="entity-event-works"><a href="#/event/${encode(event.id)}">${esc(title)}</a></p>
        <p class="entity-event-place">${place}</p>
        ${people ? `<p class="entity-event-people">${esc(people)}</p>` : ''}
      </div>
      <div class="entity-event-side">
        ${event.time ? `<span class="event-time">${esc(event.time)}</span>` : ''}
      </div>
    </li>
  `;
}
