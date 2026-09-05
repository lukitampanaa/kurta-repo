/* NebulaChat core: settings store, OpenAI-compatible client (streaming), web-search providers. */
(function () {
  'use strict';

  const LS_KEY = 'nebula_settings_v1';
  const CHAT_KEY = 'nebula_chats_v1';

  const DEFAULTS = {
    openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', organization: '' },
    params: { model: 'gpt-4o-mini', temperature: 0.7, maxTokens: 2048, topP: 1.0, systemPrompt: 'Kamu adalah NebulaChat, asisten AI yang membantu, akurat, dan ringkas. Jawab dalam Bahasa Indonesia kecuali diminta lain.\n\nAturan format (WAJIB dipatuhi):\n- Gunakan **teks tebal** untuk penekanan penting dan *miring* untuk istilah.\n- Gunakan tabel Markdown (| kolom |) untuk perbandingan atau data terstruktur.\n- Untuk rumus matematika gunakan LaTeX: $...$ untuk rumus sebaris (mis. $x^2 + y^2 = r^2$) dan $$...$$ untuk rumus blok. Contoh: $$\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$\n- Gunakan heading (##), list (- atau 1.), code block (```bahasa), dan quote (>) bila membantu keterbacaan.' },
    features: { searchDefault: false, streamDefault: true, titleAuto: true, effortDefault: 'medium' },
    search: { provider: 'tavily', apiKey: '', endpoint: '', maxResults: 5, tavilySearchDepth: 'basic' },
    adminPass: ''
  };

  function deepMerge(base, over) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const k of Object.keys(over || {})) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') {
        out[k] = deepMerge(base[k], over[k]);
      } else out[k] = over[k];
    }
    return out;
  }

  const Store = {
    load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return structuredClone(DEFAULTS);
        return deepMerge(structuredClone(DEFAULTS), JSON.parse(raw));
      } catch { return structuredClone(DEFAULTS); }
    },
    save(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); },
    reset() { localStorage.removeItem(LS_KEY); return structuredClone(DEFAULTS); }
  };

  // ---------- OpenAI-compatible client ----------
  function joinUrl(base, path) {
    return String(base || '').replace(/\/+$/, '') + path;
  }

  async function listModels(settings) {
    const { baseUrl, apiKey, organization } = settings.openai;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
    if (organization) headers['OpenAI-Organization'] = organization;
    const res = await fetch(joinUrl(baseUrl, '/models'), { headers });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    return (data.data || []).map((m) => m.id).sort();
  }

  // messages: [{role, content}] content may be string or parts array
  // opts.effort: 'low' | 'medium' | 'high' — mengatur kedalaman berpikir AI.
  const EFFORTS = {
    low:    { label: 'Low',    instruction: 'Jawab secepat dan seringkas mungkin. Maksimal 3-4 kalimat atau poin-poin sangat singkat. Jangan bertele-tele, langsung ke inti jawaban.', maxTokensCap: 512,  reasoningEffort: 'low',    searchResults: 3, searchChars: 2500 },
    medium: { label: 'Medium', instruction: 'Jawab dengan seimbang: jelas dan cukup lengkap tanpa berlebihan. Gunakan struktur (poin/tabel) bila membantu.', maxTokensCap: 2048, reasoningEffort: 'medium', searchResults: 5, searchChars: 6000 },
    high:   { label: 'High',   instruction: 'Berpikirlah secara mendalam dan langkah demi langkah sebelum menjawab. Analisis dari berbagai sudut, berikan penjelasan lengkap, contoh konkret, edge case, dan kesimpulan. Utamakan ketelitian di atas kecepatan.', maxTokensCap: 8192, reasoningEffort: 'high',   searchResults: 8, searchChars: 12000 }
  };

  function getEffort(name) {
    return EFFORTS[name] || EFFORTS.medium;
  }

  async function chatCompletion(settings, messages, opts, onToken, signal) {
    const { baseUrl, apiKey, organization } = settings.openai;
    const p = settings.params;
    const effort = getEffort(opts.effort || settings.features.effortDefault || 'medium');
    const stream = opts.stream !== false && settings.features.streamDefault !== false ? true : !!opts.stream;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
    if (organization) headers['OpenAI-Organization'] = organization;

    const body = {
      model: opts.model || p.model,
      messages: [
        { role: 'system', content: p.systemPrompt + '\n\n[Mode effort: ' + effort.label + '] ' + effort.instruction },
        ...messages
      ],
      temperature: opts.temperature ?? p.temperature,
      max_tokens: Math.min(opts.maxTokens ?? p.maxTokens, effort.maxTokensCap),
      top_p: p.topP,
      stream: stream || undefined
    };
    // reasoning effort untuk model reasoning (o1/o3/o4/deepseek-reasoner/dll)
    if (/^(o\d|o\d-mini|deepseek-reasoner|qwen.*reason|reasoner)/i.test(body.model)) {
      body.reasoning_effort = effort.reasoningEffort;
    }
    if (opts.jsonMode) body.response_format = { type: 'json_object' };

    const res = await fetch(joinUrl(baseUrl, '/chat/completions'), {
      method: 'POST', headers, body: JSON.stringify(body), signal
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error('API error ' + res.status + ': ' + t.slice(0, 300));
    }
    if (!body.stream) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      onToken(text, true);
      return { text, usage: data.usage || null };
    }
    // SSE stream
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    let usage = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          const delta = j.choices?.[0]?.delta?.content || '';
          if (delta) { full += delta; onToken(delta, false); }
          if (j.usage) usage = j.usage;
        } catch { /* partial chunk, abaikan */ }
      }
    }
    onToken('', true);
    return { text: full, usage };
  }

  // ---------- Web search ----------
  async function webSearch(settings, query, opts) {
    const s = settings.search;
    const maxR = (opts && opts.maxResults) || s.maxResults || 5;
    const provider = s.provider || 'tavily';
    if (provider === 'custom' && s.endpoint) return customSearch(s.endpoint, s.apiKey, query, maxR);
    if (provider === 'tavily') {
      if (!s.apiKey) throw new Error('API key Tavily belum diisi (atur di Panel Admin → Search).');
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: s.apiKey, query, max_results: maxR, search_depth: s.tavilySearchDepth || 'basic', include_answer: true })
      });
      if (!res.ok) throw new Error('Tavily error ' + res.status);
      const d = await res.json();
      return {
        answer: d.answer || '',
        results: (d.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content || r.snippet || '' }))
      };
    }
    if (provider === 'serper') {
      if (!s.apiKey) throw new Error('API key Serper belum diisi (atur di Panel Admin → Search).');
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': s.apiKey },
        body: JSON.stringify({ q: query, num: maxR })
      });
      if (!res.ok) throw new Error('Serper error ' + res.status);
      const d = await res.json();
      return {
        answer: d.answerBox?.answer || d.knowledgeGraph?.description || '',
        results: (d.organic || []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet || '' }))
      };
    }
    if (provider === 'brave') {
      if (!s.apiKey) throw new Error('API key Brave belum diisi (atur di Panel Admin → Search).');
      const res = await fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=' + maxR, {
        headers: { 'Accept': 'application/json', 'X-Subscription-Token': s.apiKey }
      });
      if (!res.ok) throw new Error('Brave error ' + res.status);
      const d = await res.json();
      return {
        answer: '',
        results: ((d.web && d.web.results) || []).map((r) => ({ title: r.title, url: r.url, snippet: r.description || '' }))
      };
    }
    throw new Error('Provider search tidak dikenal.');
  }

  async function customSearch(endpoint, apiKey, query, maxResults) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query, max_results: maxResults || 5 }) });
    if (!res.ok) throw new Error('Custom search error ' + res.status);
    const d = await res.json();
    return { answer: d.answer || '', results: d.results || [] };
  }

  function buildSearchContext(searchData, maxChars) {
    const cap = maxChars || 6000;
    let ctx = '';
    if (searchData.answer) ctx += 'Ringkasan mesin pencari: ' + searchData.answer + '\n\n';
    searchData.results.slice(0, 8).forEach((r, i) => {
      ctx += `[${i + 1}] ${r.title}\n${r.url}\n${(r.snippet || '').slice(0, 600)}\n\n`;
    });
    if (ctx.length > cap) ctx = ctx.slice(0, cap) + '…';
    return ctx;
  }

  // ---------- utils ----------
  function estimateTokens(str) { // ~4 chars per token
    return Math.ceil(String(str || '').length / 4);
  }
  function estimateCost(model, inTok, outTok) {
    const table = { 'gpt-4o': [2.5, 10], 'gpt-4o-mini': [0.15, 0.6], 'gpt-4.1': [2, 8], 'gpt-4.1-mini': [0.4, 1.6], 'o4-mini': [1.1, 4.4], 'o3-mini': [1.1, 4.4] };
    const key = Object.keys(table).find((k) => String(model || '').toLowerCase().includes(k));
    if (!key) return null;
    const [pi, po] = table[key];
    return (inTok / 1e6) * pi + (outTok / 1e6) * po;
  }
  function uid() { return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function toast(msg, kind) {
    let zone = document.querySelector('.toast-zone');
    if (!zone) { zone = document.createElement('div'); zone.className = 'toast-zone'; document.body.appendChild(zone); }
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    zone.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  const Chats = {
    load() {
      try { return JSON.parse(localStorage.getItem(CHAT_KEY) || '[]'); }
      catch { return []; }
    },
    save(c) { localStorage.setItem(CHAT_KEY, JSON.stringify(c)); }
  };

  window.Nebula = {
    DEFAULTS, Store, listModels, chatCompletion, EFFORTS, getEffort,
    webSearch, buildSearchContext, estimateTokens, estimateCost,
    uid, toast, Chats, CHAT_KEY
  };
})();
