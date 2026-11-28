/**
 * [INPUT]: 依赖浏览器 fetch；调用同源 /api 接口。静态模式下改读 window.MUSICA_SITE。
 * [OUTPUT]: 导出 api 对象：作品、乐团、场馆、演出、检索索引、meta、AI 配置、查重、解析与批量入库的读写方法。
 * [POS]: 前端唯一数据客户端。本地编辑版走 /api；deploy/ 静态版由 build-static 注入快照，
 *        读取方法与 API 返回同形，写方法与未收录的接口直接报只读错误。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

function authToken() {
  try {
    return sessionStorage.getItem('musica.token') || '';
  } catch {
    return '';
  }
}

/** deploy/ 由 site-data.js 设置 MUSICA_MODE 与 MUSICA_SITE；本地编辑版返回 null。 */
function staticSite() {
  if (typeof window === 'undefined' || window.MUSICA_MODE !== 'static') return null;
  return window.MUSICA_SITE || null;
}

function staticError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/** 与 /api 的响应形状保持一致；只支持读取，写操作一律拒绝。 */
function staticRequest(site, path, { method = 'GET' } = {}) {
  const data = site.data;
  if (!data) throw staticError('静态站点数据缺失，请重新运行 npm run build:static。', 500, 'NO_STATIC_DATA');
  if (method !== 'GET') {
    throw staticError('这是只读的静态发布版，不能新增、编辑或删除。', 405, 'READ_ONLY');
  }

  const [rawPath, query = ''] = String(path).split('?');
  const parts = rawPath.split('/').filter(Boolean);
  if (parts[0] !== 'api') throw staticError('接口不存在', 404, 'NOT_FOUND');

  const resource = parts[1];
  let id;
  if (parts[2] !== undefined) {
    try {
      id = decodeURIComponent(parts[2]);
    } catch {
      throw staticError('路径编码无效', 400, 'BAD_REQUEST');
    }
  }
  const meta = data.meta || {};
  const list = (items) => ({ items, total: items.length, meta });

  if (resource === 'health') {
    return {
      ok: true,
      name: 'musica',
      mode: 'static',
      write: 'none',
      counts: data.counts || {},
      meta,
    };
  }

  if (resource === 'meta') return { meta };

  if (resource === 'works') {
    if (!id) return list(data.works || []);
    const item = data.workDetails?.[id];
    if (!item) throw staticError('条目不存在', 404, 'NOT_FOUND');
    return { item, meta };
  }

  if (resource === 'ensembles') {
    if (!id) return list(data.ensembles || []);
    const item = data.ensembleDetails?.[id];
    if (!item) throw staticError('条目不存在', 404, 'NOT_FOUND');
    return { item, meta };
  }

  if (resource === 'venues') {
    if (!id) return list(data.venues || []);
    const item = data.venueDetails?.[id];
    if (!item) throw staticError('条目不存在', 404, 'NOT_FOUND');
    return { item, meta };
  }

  if (resource === 'performances') {
    if (id) {
      const item = data.performanceDetails?.[id];
      if (!item) throw staticError('演出不存在', 404, 'NOT_FOUND');
      return { item, meta };
    }
    const items = filterPerformances(data.performances || [], new URLSearchParams(query));
    return { items, total: items.length, meta };
  }

  if (resource === 'search-index') {
    return { docs: data.searchIndex || [], total: (data.searchIndex || []).length, meta };
  }

  throw staticError('接口不存在', 404, 'NOT_FOUND');
}

/** 静态快照已在构建时排序；这里只实现前端真正会传的筛选参数。 */
function filterPerformances(items, params) {
  let output = items;

  if (params.get('upcoming') === '1') {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    output = output.filter((item) => String(item.date || '') >= today);
  }

  const from = params.get('from');
  if (from) output = output.filter((item) => String(item.date || '') >= from);

  const to = params.get('to');
  if (to) output = output.filter((item) => String(item.date || '') <= to);

  const work = params.get('work');
  if (work) output = output.filter((item) => (item.works || []).some((entry) => entry.slug === work));

  const ensemble = params.get('ensemble');
  if (ensemble) {
    output = output.filter((item) => (item.ensembles || []).some((entry) => entry.slug === ensemble)
      || item.ensemble?.slug === ensemble);
  }

  const venue = params.get('venue');
  if (venue) output = output.filter((item) => item.venue?.slug === venue);

  const limit = Number(params.get('limit'));
  if (limit > 0) output = output.slice(0, Math.min(500, limit));

  return output;
}

async function request(path, options = {}) {
  const site = staticSite();
  if (site) return staticRequest(site, path, options);

  const { method = 'GET', body } = options;
  const token = authToken();
  const headers = {
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error?.message || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }

  return payload;
}

export const api = {
  health() {
    return request('api/health');
  },
  works() {
    return request('api/works');
  },
  work(slug) {
    return request(`api/works/${encodeURIComponent(slug)}`);
  },
  createWork(body) {
    return request('api/works', { method: 'POST', body });
  },
  updateWork(slug, body) {
    return request(`api/works/${encodeURIComponent(slug)}`, { method: 'PATCH', body });
  },
  deleteWork(slug) {
    return request(`api/works/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  },
  ensembles() {
    return request('api/ensembles');
  },
  ensemble(slug) {
    return request(`api/ensembles/${encodeURIComponent(slug)}`);
  },
  createEnsemble(body) {
    return request('api/ensembles', { method: 'POST', body });
  },
  updateEnsemble(slug, body) {
    return request(`api/ensembles/${encodeURIComponent(slug)}`, { method: 'PATCH', body });
  },
  deleteEnsemble(slug) {
    return request(`api/ensembles/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  },
  venues() {
    return request('api/venues');
  },
  venue(slug) {
    return request(`api/venues/${encodeURIComponent(slug)}`);
  },
  createVenue(body) {
    return request('api/venues', { method: 'POST', body });
  },
  updateVenue(slug, body) {
    return request(`api/venues/${encodeURIComponent(slug)}`, { method: 'PATCH', body });
  },
  deleteVenue(slug) {
    return request(`api/venues/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  },
  performance(id) {
    return request(`api/performances/${encodeURIComponent(id)}`);
  },
  createPerformance(body) {
    return request('api/performances', { method: 'POST', body });
  },
  updatePerformance(id, body) {
    return request(`api/performances/${encodeURIComponent(id)}`, { method: 'PATCH', body });
  },
  deletePerformance(id) {
    return request(`api/performances/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  performances(filters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const query = params.toString();
    return request(`api/performances${query ? `?${query}` : ''}`);
  },
  searchIndex() {
    return request('api/search-index');
  },
  meta() {
    return request('api/meta');
  },
  aiManifest() {
    return request('api/ai');
  },
  aiConfig() {
    return request('api/ai/config');
  },
  updateAiConfig(body) {
    return request('api/ai/config', { method: 'PATCH', body });
  },
  aiDuplicate(url) {
    return request(`api/ai/duplicate?url=${encodeURIComponent(url)}`);
  },
  parseWechat(body) {
    return request('api/ai/parse', { method: 'POST', body });
  },
  ingest(body) {
    return request('api/ingest', { method: 'POST', body });
  },
};
