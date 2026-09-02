'use strict';

(() => {
  const tm = window.tokenMonitor;
  const compactTokens = window.TokenMonitorCompactTokens;
  const compactMoney = window.TokenMonitorCompactMoney;
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
  const BREAKDOWN_ROW_LIMIT = 6;

  function addTo(map, key, value) {
    const amount = Number(value);
    if (!map || !key || !Number.isFinite(amount) || amount === 0) return;
    map[key] = (map[key] || 0) + amount;
  }

  const state = {
    stats: null,
    settings: null,
    period: 'today',
    breakdown: 'tool',
    week: null,
    historyRevision: '',
    expanded: false
  };

  const els = {
    liveDot: document.getElementById('liveDot'),
    toggle: document.getElementById('toggleButton'),
    cards: Array.from(document.querySelectorAll('.period-card')),
    breakdownTitle: document.getElementById('breakdownTitle'),
    breakdownPeriodLabel: document.getElementById('breakdownPeriodLabel'),
    breakdownRows: document.getElementById('breakdownRows'),
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
    currencyApi.configureRates(map);
  }

  function settingsValue() {
    return state.settings || {};
  }

  function fmtTokens(value) {
    const s = settingsValue();
    return compactTokens.formatCompactTokens(Number(value) || 0, s.compactTokenUnits || 'western', s.language || 'en');
  }

  function fmtMoney(value) {
    const s = settingsValue();
    return compactMoney.formatCompactCurrencyFromUsd(Number(value) || 0, s.currency || 'USD', s.compactTokenUnits || 'western', s.language || 'en', { fractionDigits: 2 });
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
    // The history graph may already carry today. Prefer the fresher live read
    // and avoid double counting; otherwise keep the archived today row.
    const useLiveToday = Boolean(todayPeriod) && todayPeriod.totalTokens > 0 && todayPeriod.totalTokens >= dailyTodayTokens;
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
    // Overlay the live today period so the week never trails the real-time read.
    if (useLiveToday) {
      hasRows = true;
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

  async function loadWeek() {
    try {
      const history = await tm.getDashboardHistory({});
      state.week = buildWeekPeriod(
        history && history.daily,
        state.stats && state.stats.periods && state.stats.periods.today
      );
    } catch (_) {
      state.week = null;
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

  function renderCards() {
    for (const card of els.cards) {
      const key = card.dataset.period;
      card.classList.toggle('active', state.period === key);
      const period = periodForKey(key);
      const tokens = document.getElementById(`tokens-${key}`);
      const cost = document.getElementById(`cost-${key}`);
      if (period) {
        tokens.textContent = fmtTokens(period.totalTokens);
        cost.textContent = fmtMoney(period.costUsd);
      } else {
        tokens.textContent = '—';
        cost.textContent = '—';
      }
    }
  }

  function renderBreakdown() {
    const period = periodForKey(state.period);
    const isModel = state.breakdown === 'model';
    els.breakdownTitle.textContent = isModel ? 'BY MODEL' : 'BY TOOL';
    els.breakdownPeriodLabel.textContent = PERIOD_LABELS[state.period] || state.period.toUpperCase();

    const rows = [];
    if (period) {
      if (isModel) {
        const keys = new Set([...Object.keys(period.models || {}), ...Object.keys(period.modelCosts || {})]);
        for (const key of keys) {
          const tokens = Number(period.models && period.models[key]) || 0;
          const cost = Number(period.modelCosts && period.modelCosts[key]) || 0;
          if (tokens > 0 || cost > 0) rows.push({ id: key, label: formatModelName(key), tokens, cost });
        }
      } else {
        const keys = new Set([...Object.keys(period.clients || {}), ...Object.keys(period.clientCosts || {})]);
        for (const key of keys) {
          const tokens = Number(period.clients && period.clients[key]) || 0;
          const cost = Number(period.clientCosts && period.clientCosts[key]) || 0;
          if (tokens > 0 || cost > 0) {
            const id = String(key).toLowerCase();
            rows.push({ id, key, label: CLIENT_LABELS[id] || key, tokens, cost });
          }
        }
      }
    }
    rows.sort((left, right) => right.tokens - left.tokens || right.cost - left.cost);

    const limit = state.expanded ? rows.length : Math.min(BREAKDOWN_ROW_LIMIT, Math.max(rows.length, 1));
    const maxTokens = Math.max(1, ...rows.map((row) => row.tokens));
    els.breakdownRows.replaceChildren();

    if (rows.length === 0) {
      els.breakdownRows.appendChild(element('div', 'limit-empty', 'No usage yet'));
      return;
    }

    for (const row of rows.slice(0, limit)) {
      const line = element('div', 'row');
      line.appendChild(iconNode(isModel ? row.id : row.key, row.label));
      line.appendChild(element('span', 'row-name', row.label));
      line.appendChild(element('span', 'row-tokens', fmtTokens(row.tokens)));
      line.appendChild(element('span', 'row-cost', fmtMoney(row.cost)));
      const bar = element('div', 'row-bar');
      const fill = element('div', 'row-bar-fill');
      fill.style.width = `${Math.max(2, Math.round((row.tokens / maxTokens) * 100))}%`;
      bar.appendChild(fill);
      line.appendChild(bar);
      els.breakdownRows.appendChild(line);
    }
    if (rows.length > limit) {
      const more = element('button', 'row-more', `+${rows.length - limit} more`);
      more.addEventListener('click', () => {
        state.expanded = true;
        renderBreakdown();
      });
      els.breakdownRows.appendChild(more);
    }
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
    renderCards();
    renderBreakdown();
    renderLimits();
    renderFooter();
    renderLiveDot();
  }

  function onStats(payload) {
    const stats = payload && payload.data && payload.data.stats
      ? payload.data.stats
      : payload && payload.stats;
    if (!stats) return;
    state.stats = stats;
    const revision = String(stats.deviceHistoryRevision || '');
    if (revision !== state.historyRevision) {
      state.historyRevision = revision;
      loadWeek();
    } else {
      render();
    }
  }

  function onSettings(settings) {
    state.settings = settings || {};
    state.breakdown = state.settings.breakdownMode === 'model' ? 'model' : 'tool';
    els.toggle.classList.toggle('active', state.breakdown === 'model');
    els.toggle.title = state.breakdown === 'model' ? '当前按模型 · 点击切换为按工具' : '当前按工具 · 点击切换为按模型';
    configureCurrency();
    render();
  }

  function bindEvents() {
    for (const card of els.cards) {
      card.addEventListener('click', () => {
        state.period = card.dataset.period;
        render();
      });
    }
    els.toggle.addEventListener('click', () => {
      const next = state.breakdown === 'model' ? 'tool' : 'model';
      tm.updateSettings({ breakdownMode: next }).catch(() => {});
    });
    document.getElementById('minButton').addEventListener('click', () => tm.minimize());
    document.getElementById('closeButton').addEventListener('click', () => tm.close());

    tm.onStatsPush(onStats);
    tm.onSettingsPush(onSettings);
    tm.onDashboardHistoryChanged(() => loadWeek());
  }

  async function init() {
    const [stats, settings] = await Promise.all([
      tm.getStats().catch(() => null),
      tm.getSettings().catch(() => null)
    ]);
    onSettings(settings);
    onStats({ data: { stats } });
    bindEvents();
    tm.signalContentReady();
    window.setInterval(() => renderLiveDot(), 15000);
  }

  function debugSetStats(stats) {
    state.stats = stats || null;
    const revision = String(stats && stats.deviceHistoryRevision || '');
    if (revision !== state.historyRevision) { state.historyRevision = revision; loadWeek(); }
    else render();
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
