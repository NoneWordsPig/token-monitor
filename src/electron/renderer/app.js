'use strict';

(() => {
  const tm = window.tokenMonitor;
  const currencyApi = window.TokenMonitorCurrency;

  const CLIENT_LABELS = {
    claude: 'Claude', codex: 'Codex', opencode: 'OpenCode', hermes: 'Hermes',
    openclaw: 'OpenClaw', cursor: 'Cursor', antigravity: 'Antigravity',
    cline: 'Cline', kimi: 'Kimi', qwen: 'Qwen', grok: 'Grok',
    copilot: 'GitHub Copilot', pi: 'Pi', zed: 'Zed', kilocode: 'Kilo Code',
    commandcode: 'Command Code', zcode: 'Z Code', kiro: 'Kiro',
    codebuddy: 'CodeBuddy', workbuddy: 'WorkBuddy', proma: 'Proma',
    reasonix: 'Reasonix', dsh: 'DSH', micode: 'MiCode', qodercn: 'Qoder CN',
    gemini: 'Gemini', deepseek: 'DeepSeek', minimax: 'MiniMax',
    mistral: 'Mistral', moonshot: 'Moonshot', ollama: 'Ollama',
    openrouter: 'OpenRouter', doubao: 'Doubao', hunyuan: 'Hunyuan',
    volcengine: 'Volcengine', xai: 'xAI', newapi: 'New API',
    cohere: 'Cohere', meta: 'Meta', xiaomi: 'Xiaomi', zai: 'ZAI'
  };

  const ICON_FILES = {
    claude: 'claude.svg', codex: 'codex.svg', opencode: 'opencode.svg',
    hermes: 'hermes-agent.svg', openclaw: 'openclaw.svg', cursor: 'cursor.svg',
    antigravity: 'antigravity.svg', cline: 'cline.svg', kimi: 'kimi.svg',
    qwen: 'qwen.svg', grok: 'grok.svg', copilot: 'copilot.svg', pi: 'pi.svg',
    zed: 'zed.svg', kilocode: 'kilocode.svg', commandcode: 'commandcode.svg',
    kiro: 'kiro.svg', codebuddy: 'codebuddy.svg', workbuddy: 'workbuddy.svg',
    proma: 'proma.svg', reasonix: 'reasonix.svg', dsh: 'dsh.svg',
    qodercn: 'qodercn.svg', gemini: 'gemini.svg', deepseek: 'deepseek.svg',
    minimax: 'minimax.svg', mistral: 'mistral.svg', moonshot: 'moonshot.svg',
    ollama: 'ollama.svg', openrouter: 'openrouter.svg', doubao: 'doubao.svg',
    hunyuan: 'hunyuan.svg', volcengine: 'volcengine.svg', xai: 'xai.svg',
    newapi: 'newapi.svg', cohere: 'cohere.svg', meta: 'meta.svg',
    xiaomi: 'xiaomi.svg', zai: 'zai.svg'
  };

  const PROVIDER_LABELS = {
    claude: 'Claude', codex: 'Codex', openai: 'OpenAI', copilot: 'GitHub Copilot',
    cursor: 'Cursor', opencode: 'OpenCode', antigravity: 'Antigravity',
    openrouter: 'OpenRouter', deepseek: 'DeepSeek', minimax: 'MiniMax',
    kimi: 'Kimi', qwen: 'Qwen', grok: 'Grok', zai: 'ZAI', zaiteam: 'ZAI Team',
    volcengine: 'Volcengine', qoder: 'Qoder', commandcode: 'Command Code',
    kiro: 'Kiro', workbuddy: 'WorkBuddy', trae: 'Trae', ollama: 'Ollama',
    mimo: 'Mimo', thirdparty: 'Third-party'
  };

  const PERIOD_LABELS = { today: 'TODAY', week: 'THIS WEEK', month: 'THIS MONTH' };
  const LIST_ROW_LIMIT = 4;
  const CACHE_KEY = 'tm.lite.cache.v1';
  const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const REFRESH_MS = 60 * 1000;

  function periodHasUsage(period) {
    return period
      && (Number(period.totalTokens) > 0 || Number(period.costUsd) > 0);
  }

  function statsHaveUsage(stats) {
    const periods = stats && stats.periods;
    if (!periods) return false;
    for (const name of ['today', 'month', 'allTime']) {
      if (periodHasUsage(periods[name])) return true;
    }
    return false;
  }

  function isWarmingUp() {
    // Before the collector's first real scan lands the snapshot is an empty
    // skeleton. Treat that as "still loading" instead of painting zeros.
    return !state.statsHaveUsage && Date.now() < state.warmupUntil;
  }

  function addTo(map, key, value) {
    const amount = Number(value);
    if (!map || !key || !Number.isFinite(amount) || amount === 0) return;
    map[key] = (map[key] || 0) + amount;
  }

  const state = {
    stats: null,
    settings: null,
    period: 'today',
    dailyRows: null,
    week: null,
    historyRevision: '',
    expandedTool: false,
    expandedModel: false,
    statsLoaded: false,
    statsHaveUsage: false,
    lastCacheSaveAt: 0,
    warmupUntil: 0
  };

  const els = {
    liveDot: document.getElementById('liveDot'),
    rows: Array.from(document.querySelectorAll('.period-row')),
    breakdownPeriodLabel: document.getElementById('breakdownPeriodLabel'),
    breakdownRows: document.getElementById('breakdownRows'),
    modelsPeriodLabel: document.getElementById('modelsPeriodLabel'),
    modelsRows: document.getElementById('modelsRows'),
    limitsRows: document.getElementById('limitsRows'),
    footerTotal: document.getElementById('footerTotal'),
    footerUpdated: document.getElementById('footerUpdated')
  };

  function configureCurrency() {
    const rates = state.settings && state.settings.currencyRates;
    const map = {};
    if (rates && typeof rates === 'object') {
      for (const [code, value] of Object.entries(rates)) {
        const rate = value && typeof value === 'object' ? value.rate : value;
        const numeric = Number(rate);
        if (Number.isFinite(numeric) && numeric > 0) map[String(code).toUpperCase()] = numeric;
      }
    }
    if (currencyApi && typeof currencyApi.configureRates === 'function') {
      currencyApi.configureRates(map);
    }
  }

  function settingsValue() {
    return state.settings || {};
  }

  // The Lite window shows exact counts instead of K/M/万 compression so each
  // figure is unambiguous; money always keeps a fixed 2-decimal format.
  function fmtTokens(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US');
  }

  function fmtMoney(value) {
    const s = settingsValue();
    const code = currencyApi && typeof currencyApi.normalizeCurrency === 'function'
      ? currencyApi.normalizeCurrency(s.currency || 'USD')
      : 'USD';
    const amount = typeof currencyApi.convertUsd === 'function'
      ? currencyApi.convertUsd(value, code)
      : Number(value) || 0;
    const rates = currencyApi && currencyApi.CURRENCY_RATES;
    const symbol = (rates && rates[code] && rates[code].symbol) || `${code} `;
    return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtRawMoney(value, currency) {
    const rates = currencyApi && currencyApi.CURRENCY_RATES;
    const code = rates && currencyApi.normalizeCurrency
      ? currencyApi.normalizeCurrency(currency)
      : 'USD';
    const symbol = (rates && rates[code] && rates[code].symbol) || code + ' ';
    return symbol + (Number(value) || 0).toFixed(2);
  }

  function fmtPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return `${Math.round(n)}%`;
  }

  function formatDateShort(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}`;
  }

  function formatModelName(id) {
    const raw = String(id || '');
    if (!raw) return '';
    return raw
      .replace(/[-_]+/g, ' ')
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }

  function localDayKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function weekStartKey(todayKey, locale) {
    const date = new Date(`${todayKey}T00:00:00Z`);
    let firstDay = 1; // ISO weeks start Monday.
    try {
      const resolved = new Intl.Locale(String(locale || 'en'));
      const info = resolved.getWeekInfo ? resolved.getWeekInfo() : resolved.weekInfo;
      const value = Number(info && info.firstDay);
      if (Number.isInteger(value) && value >= 1 && value <= 7) firstDay = value % 7;
    } catch (_) { /* keep ISO Monday */ }
    const offset = (date.getUTCDay() - firstDay + 7) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  }

  // Week = archived daily rows from the week start through yesterday, plus the
  // freshest live "today" read. The archived row for today is only used when the
  // live read is missing or smaller (a live scan may still be warming up), and
  // it is re-derived on every render so the WEEK figure never trails TODAY while
  // the collector keeps pushing newer daily numbers.
  function buildWeekPeriod(daily, todayPeriod) {
    const today = new Date();
    const todayKey = localDayKey(today);
    const start = weekStartKey(todayKey, (state.settings && state.settings.language) || 'en');
    const period = {
      totalTokens: 0,
      costUsd: 0,
      clients: {},
      clientCosts: {},
      models: {},
      modelCosts: {}
    };
    let hasRows = false;
    const dailyRows = Array.isArray(daily) ? daily : [];
    const dailyTodayTokens = (dailyRows.find((row) => String(row && row.date || '').slice(0, 10) === todayKey) || {}).tokens || 0;
    const liveTokens = Number(todayPeriod && todayPeriod.totalTokens) || 0;
    // Prefer the live today read when it is present and not smaller than what
    // the archive last saw, so the week never walks backwards between full
    // history scans; otherwise keep the archived today row.
    const useLiveToday = liveTokens > 0 && liveTokens >= dailyTodayTokens;
    for (const row of dailyRows) {
      const date = String(row && row.date || '').slice(0, 10);
      if (!date || date < start || date > todayKey) continue;
      if (date === todayKey && useLiveToday) continue;
      hasRows = true;
      period.totalTokens += Number(row.tokens) || 0;
      period.costUsd += Number(row.cost) || 0;
      for (const [client, value] of Object.entries(row.perClient || {})) {
        addTo(period.clients, client, value && value.tokens);
        addTo(period.clientCosts, client, value && value.cost);
      }
      for (const [model, value] of Object.entries(row.perModel || {})) {
        addTo(period.models, model, value && value.tokens);
        addTo(period.modelCosts, model, value && value.cost);
      }
    }
    if (useLiveToday) {
      hasRows = true;
      // The archived today row was skipped above, so the live read must also
      // contribute the headline totals — previously only its per-client/model
      // maps were added, which is why WEEK could read lower than TODAY.
      period.totalTokens += Number(todayPeriod.totalTokens) || 0;
      period.costUsd += Number(todayPeriod.costUsd) || 0;
      for (const [client, tokens] of Object.entries(todayPeriod.clients || {})) {
        addTo(period.clients, client, tokens);
      }
      for (const [client, cost] of Object.entries(todayPeriod.clientCosts || {})) {
        addTo(period.clientCosts, client, cost);
      }
      for (const [model, tokens] of Object.entries(todayPeriod.models || {})) {
        addTo(period.models, model, tokens);
      }
      for (const [model, cost] of Object.entries(todayPeriod.modelCosts || {})) {
        addTo(period.modelCosts, model, cost);
      }
    }
    return hasRows ? period : null;
  }

  function computeWeek() {
    const stats = state.stats;
    const todayPeriod = stats && stats.periods && stats.periods.today;
    state.week = buildWeekPeriod(state.dailyRows, todayPeriod);
    return state.week;
  }

  async function loadHistory() {
    try {
      const history = await tm.getDashboardHistory({});
      state.dailyRows = Array.isArray(history && history.daily) ? history.daily : [];
    } catch (_) {
      state.dailyRows = Array.isArray(state.dailyRows) ? state.dailyRows : [];
    }
    render();
  }

  function periodForKey(key) {
    if (!state.stats) return null;
    if (key === 'week') return state.week || null;
    return (state.stats.periods && state.stats.periods[key]) || null;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function iconNode(id, label) {
    const wrap = element('span', 'row-icon');
    const file = ICON_FILES[String(id).toLowerCase()];
    if (file) {
      const img = document.createElement('img');
      img.src = `../../../assets/icons/${file}`;
      img.alt = '';
      img.draggable = false;
      img.addEventListener('error', () => {
        if (!wrap.classList.contains('fallback')) {
          wrap.classList.add('fallback');
          wrap.textContent = String(label || id || '?').charAt(0).toUpperCase();
        }
      });
      wrap.appendChild(img);
    } else {
      wrap.classList.add('fallback');
      wrap.textContent = String(label || id || '?').charAt(0).toUpperCase();
    }
    return wrap;
  }

  function renderPeriodRows() {
    for (const row of els.rows) {
      const key = row.dataset.period;
      row.classList.toggle('active', state.period === key);
      const tokensNode = document.getElementById(`tokens-${key}`);
      const costNode = document.getElementById(`cost-${key}`);
      const period = periodForKey(key);
      if (period && (isWarmingUp() ? periodHasUsage(period) : true)) {
        tokensNode.textContent = fmtTokens(period.totalTokens);
        costNode.textContent = fmtMoney(period.costUsd);
      } else {
        tokensNode.textContent = '—';
        costNode.textContent = '—';
      }
    }
  }

  function gatherRows(period, mode) {
    const rows = [];
    if (!period) return rows;
    const isModel = mode === 'model';
    const tokenMap = isModel ? period.models : period.clients;
    const costMap = isModel ? period.modelCosts : period.clientCosts;
    const keys = new Set([...Object.keys(tokenMap || {}), ...Object.keys(costMap || {})]);
    for (const key of keys) {
      const tokens = Number(tokenMap && tokenMap[key]) || 0;
      const cost = Number(costMap && costMap[key]) || 0;
      if (tokens <= 0 && cost <= 0) continue;
      const clientId = String(key).toLowerCase();
      rows.push({
        id: key,
        clientId,
        label: isModel ? formatModelName(key) : (CLIENT_LABELS[clientId] || key),
        tokens,
        cost
      });
    }
    rows.sort((left, right) => right.tokens - left.tokens || right.cost - left.cost);
    return rows;
  }

  function renderList(container, rows, expandedKey, emptyText) {
    container.replaceChildren();
    if (!state.statsLoaded) {
      container.appendChild(element('div', 'limit-empty', 'Loading…'));
      return;
    }
    if (rows.length === 0 && isWarmingUp()) {
      container.appendChild(element('div', 'limit-empty', 'Loading…'));
      return;
    }
    if (rows.length === 0) {
      container.appendChild(element('div', 'limit-empty', emptyText || 'No usage yet'));
      return;
    }
    const limit = state[expandedKey] ? rows.length : Math.min(LIST_ROW_LIMIT, Math.max(rows.length, 1));
    const maxTokens = Math.max(1, ...rows.map((row) => row.tokens));
    for (const row of rows.slice(0, limit)) {
      const line = element('div', 'row');
      line.appendChild(iconNode(row.clientId || row.id, row.label));
      line.appendChild(element('span', 'row-name', row.label));
      line.appendChild(element('span', 'row-tokens', fmtTokens(row.tokens)));
      line.appendChild(element('span', 'row-cost', fmtMoney(row.cost)));
      const bar = element('div', 'row-bar');
      const fill = element('div', 'row-bar-fill');
      fill.style.width = `${Math.max(2, Math.round((row.tokens / maxTokens) * 100))}%`;
      bar.appendChild(fill);
      line.appendChild(bar);
      container.appendChild(line);
    }
    if (rows.length > limit) {
      const more = element('button', 'row-more', `+${rows.length - limit} more`);
      more.addEventListener('click', () => {
        state[expandedKey] = true;
        render();
      });
      container.appendChild(more);
    }
  }

  function renderBreakdown() {
    els.breakdownPeriodLabel.textContent = PERIOD_LABELS[state.period] || state.period.toUpperCase();
    renderList(els.breakdownRows, gatherRows(periodForKey(state.period), 'tool'), 'expandedTool', 'No usage yet');
  }

  function renderModels() {
    els.modelsPeriodLabel.textContent = PERIOD_LABELS[state.period] || state.period.toUpperCase();
    renderList(els.modelsRows, gatherRows(periodForKey(state.period), 'model'), 'expandedModel', 'No model usage yet');
  }

  function renderLimits() {
    els.limitsRows.replaceChildren();
    const providers = (state.stats && state.stats.limits && state.stats.limits.providers) || [];
    if (!Array.isArray(providers) || providers.length === 0) {
      els.limitsRows.appendChild(element('div', 'limit-empty', 'No limits configured'));
      return;
    }
    const visible = providers.filter((provider) => (Array.isArray(provider.windows) && provider.windows.length > 0) || provider.balanceUsd !== null && provider.balanceUsd !== undefined || provider.balance !== null && provider.balance !== undefined);
    if (visible.length === 0) {
      els.limitsRows.appendChild(element('div', 'limit-empty', 'No limits configured'));
      return;
    }
    const sorted = visible.slice().sort((left, right) =>
      String(PROVIDER_LABELS[left.provider] || left.provider).localeCompare(String(PROVIDER_LABELS[right.provider] || right.provider))
    );
    for (const provider of sorted) {
      const card = element('div', 'limit-provider');
      const head = element('div', 'limit-provider-head');
      head.appendChild(element('span', 'limit-provider-name', PROVIDER_LABELS[provider.provider] || provider.provider));
      const plan = provider.planLabel || provider.accountLabel || '';
      if (plan) head.appendChild(element('span', 'limit-provider-plan', plan));
      card.appendChild(head);

      const windows = Array.isArray(provider.windows) ? provider.windows : [];
      if (windows.length === 0) {
        card.appendChild(element('div', 'limit-window-label', '—'));
      }
      for (const win of windows) {
        const row = element('div', 'limit-window');
        row.appendChild(element('span', 'limit-window-label', win.label || win.kind || ''));
        const hasPercent = win.usedPercent !== null && win.usedPercent !== undefined;
        const percent = Number(win.usedPercent);
        const hasLimit = win.limit !== null && win.limit !== undefined;
        const isTokensMetric = win.metric === 'tokens';
        const valueParts = [];
        if (hasPercent && hasLimit) {
          valueParts.push(`${fmtTokens(win.used)} / ${fmtTokens(win.limit)}`);
        } else if (win.remaining !== null && win.remaining !== undefined) {
          valueParts.push(`${isTokensMetric ? fmtTokens(win.remaining) : fmtRawMoney(win.remaining, win.currency)} left`);
        }
        if (hasPercent && Number.isFinite(percent)) valueParts.push(fmtPercent(percent));
        if (win.resetsAt) valueParts.push(`resets ${formatDateShort(win.resetsAt)}`);

        if (hasPercent && Number.isFinite(percent) && win.showMeter !== false) {
          const meter = element('div', 'limit-meter');
          const fill = element('div', 'limit-meter-fill');
          fill.style.width = `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
          if (percent >= 85) fill.classList.add('danger');
          else if (percent >= 70) fill.classList.add('warn');
          meter.appendChild(fill);
          row.appendChild(meter);
        }
        row.appendChild(element('span', 'limit-window-value', valueParts.join(' · ') || '—'));
        card.appendChild(row);
      }
      els.limitsRows.appendChild(card);
    }
  }

  function renderFooter() {
    const allTime = state.stats && state.stats.periods && state.stats.periods.allTime;
    els.footerTotal.textContent = allTime
      ? `TOTAL ${fmtTokens(allTime.totalTokens)} · ${fmtMoney(allTime.costUsd)}`
      : 'TOTAL —';
    const updatedAt = state.stats && state.stats.updatedAt;
    if (updatedAt) {
      const date = new Date(updatedAt);
      if (!Number.isNaN(date.getTime())) {
        els.footerUpdated.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        els.footerUpdated.textContent = '';
      }
    } else {
      els.footerUpdated.textContent = '';
    }
  }

  function renderLiveDot() {
    const updatedAt = state.stats && state.stats.updatedAt;
    const fresh = updatedAt
      && (Date.now() - new Date(updatedAt).getTime()) < 60000;
    els.liveDot.classList.toggle('on', Boolean(fresh));
  }

  function render() {
    computeWeek();
    renderPeriodRows();
    renderBreakdown();
    renderModels();
    renderLimits();
    renderFooter();
    renderLiveDot();
  }

  // Trim the pushed snapshot to just the fields this window renders so the
  // cold-start cache stays small enough for localStorage.
  function trimPeriod(period) {
    if (!period || typeof period !== 'object') return null;
    return {
      totalTokens: period.totalTokens,
      costUsd: period.costUsd,
      clients: period.clients || null,
      clientCosts: period.clientCosts || null,
      models: period.models || null,
      modelCosts: period.modelCosts || null
    };
  }

  function cachePayload() {
    const stats = state.stats;
    if (!stats || !stats.periods) return null;
    const week = computeWeek();
    return {
      dayKey: localDayKey(new Date()),
      savedAt: new Date().toISOString(),
      updatedAt: stats.updatedAt || '',
      deviceHistoryRevision: state.historyRevision,
      periods: {
        today: trimPeriod(stats.periods.today),
        month: trimPeriod(stats.periods.month),
        allTime: trimPeriod(stats.periods.allTime)
      },
      limits: stats.limits || null,
      week: week ? trimPeriod(week) : null,
      settings: state.settings
        ? {
          currency: state.settings.currency,
          language: state.settings.language,
          compactTokenUnits: state.settings.compactTokenUnits,
          currencyRates: state.settings.currencyRates
        }
        : null
    };
  }

  function saveCache(force) {
    const now = Date.now();
    if (!force && now - state.lastCacheSaveAt < 30000) return;
    state.lastCacheSaveAt = now;
    try {
      const payload = cachePayload();
      if (!payload) return;
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (_) {
      try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
    }
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.dayKey !== localDayKey(new Date())) return null;
      const age = Date.now() - Date.parse(parsed.savedAt || 0);
      if (!Number.isFinite(age) || age < 0 || age > CACHE_MAX_AGE_MS) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function hydrateCache() {
    const cached = readCache();
    if (!cached) return;
    if (cached.settings) state.settings = cached.settings;
    if (cached.periods && cached.settings) configureCurrency();
    state.historyRevision = String(cached.deviceHistoryRevision || '');
    const stats = {
      periods: cached.periods || {},
      limits: cached.limits || null,
      updatedAt: cached.updatedAt || ''
    };
    if (cached.week) {
      const week = {
        totalTokens: cached.week.totalTokens || 0,
        costUsd: cached.week.costUsd || 0,
        clients: cached.week.clients || {},
        clientCosts: cached.week.clientCosts || {},
        models: cached.week.models || {},
        modelCosts: cached.week.modelCosts || {}
      };
      state.week = week;
    }
    state.stats = stats;
    state.statsLoaded = true;
    state.statsHaveUsage = statsHaveUsage(stats);
  }

  function applyStats(stats, { forceHistoryRefresh = false } = {}) {
    if (!stats) return;
    state.stats = stats;
    state.statsLoaded = true;
    state.statsHaveUsage = statsHaveUsage(stats);
    const revision = String(stats.deviceHistoryRevision || stats.historyRevision || '');
    const revisionChanged = revision !== state.historyRevision;
    state.historyRevision = revision;
    if (revisionChanged || forceHistoryRefresh || state.dailyRows === null) {
      void loadHistory();
    } else {
      render();
    }
    saveCache(revisionChanged);
  }

  function onStats(payload) {
    const stats = payload && payload.data && payload.data.stats
      ? payload.data.stats
      : payload && payload.stats;
    if (!stats) return;
    applyStats(stats);
  }

  function onSettings(settings) {
    state.settings = settings || {};
    configureCurrency();
    render();
    saveCache(true);
  }

  function bindEvents() {
    for (const row of els.rows) {
      row.addEventListener('click', () => {
        if (row.dataset.period === state.period) return;
        state.period = row.dataset.period;
        // A new window resets the per-section "more" expansion so the top N
        // stay visible without a lingering scroll position from the old period.
        state.expandedTool = false;
        state.expandedModel = false;
        render();
      });
    }
    document.getElementById('minButton').addEventListener('click', () => tm.minimize());
    document.getElementById('closeButton').addEventListener('click', () => tm.close());

    tm.onStatsPush(onStats);
    tm.onSettingsPush(onSettings);
    tm.onDashboardHistoryChanged(() => { void loadHistory(); });

    // Cheap 60s poll: re-reads the main process's latest cached snapshot over
    // IPC without forcing a rescan, so it only costs a few ms per tick. Real
    // number changes still arrive on collector pushes / watch events.
    window.setInterval(() => {
      // Hidden (tray) windows keep their timers throttled anyway; skip the
      // read entirely so hub-client mode does not phone its hub every minute
      // while nothing is on screen.
      if (document.hidden) return;
      tm.getStats().then((stats) => applyStats(stats)).catch(() => {});
    }, REFRESH_MS);
  }

  async function init() {
    state.warmupUntil = Date.now() + 8000;
    // Paint last-known data (same day only) before the async IPC round trips
    // resolve, so a recreated window is never blank while stats load.
    hydrateCache();
    render();
    bindEvents();
    // The window reveal in main.js waits for this signal; sending it right
    // after the first paint keeps the open-to-data gap as short as possible.
    tm.signalContentReady();

    const [stats, settings] = await Promise.all([
      tm.getStats().catch(() => null),
      tm.getSettings().catch(() => null)
    ]);
    onSettings(settings);
    applyStats(stats, { forceHistoryRefresh: true });
    // Once the warm-up window ends with no usage anywhere, repaint zeros so an
    // empty-but-fresh install does not sit on "Loading…" forever.
    window.setTimeout(() => { if (isWarmingUp()) render(); }, 8500);
  }

  function debugSetStats(stats) {
    applyStats(stats || null, { forceHistoryRefresh: true });
  }

  function debugSetSettings(settings) {
    onSettings(settings || {});
  }

  if (location.search.includes('liteDebug=1')) {
    window.__liteDebug = {
      state,
      setStats: debugSetStats,
      setSettings: debugSetSettings,
      render,
      fmtTokens,
      fmtMoney
    };
  }

  init();
})();





