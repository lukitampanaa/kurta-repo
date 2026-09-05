/* NebulaChat admin: API/backend, models, search providers, app settings, data mgmt. */
(function () {
  'use strict';
  const N = window.Nebula;
  let S = N.Store.load();
  let tab = 'api';

  const $ = (id) => document.getElementById(id);
  const inner = $('adminInner');

  const PRESETS = {
    'OpenAI': 'https://api.openai.com/v1',
    'OpenRouter': 'https://openrouter.ai/api/v1',
    'Ollama (lokal)': 'http://localhost:11434/v1',
    'LM Studio (lokal)': 'http://localhost:1234/v1',
    'Custom…': ''
  };

  function save() {
    N.Store.save(S);
    $('saveState').textContent = 'tersimpan ✓ ' + new Date().toLocaleTimeString('id-ID');
  }
  function bind() {
    inner.querySelectorAll('[data-set]').forEach((el) => {
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        const path = el.getAttribute('data-set').split('.');
        let o = S;
        for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
        const last = path[path.length - 1];
        if (el.type === 'checkbox') o[last] = el.checked;
        else if (el.type === 'number' || el.type === 'range') o[last] = parseFloat(el.value);
        else o[last] = el.value;
        save();
      });
    });
  }
  function statusLine(id, ok, msg) {
    $(id).innerHTML = `<span class="status-dot ${ok ? 'ok' : 'err'}"></span>${msg}`;
  }

  function viewApi() {
    inner.innerHTML = `
      <h1>Koneksi API &amp; Backend</h1>
      <p class="desc">Kompatibel OpenAI: OpenAI, Azure, OpenRouter, Ollama, LM Studio, vLLM, dan server custom.</p>
      <div class="panel-card">
        <h3>Backend aktif</h3>
        <p>Pilih preset atau isi base URL sendiri. Key tersimpan lokal di browser (localStorage), tidak dikirim ke mana pun selain backend yang kamu isi.</p>
        <div class="field"><span>Preset backend</span>
          <select id="preset">
            ${Object.keys(PRESETS).map((k) => `<option ${PRESETS[k] === S.openai.baseUrl ? 'selected' : ''}>${k}</option>`).join('')}
          </select>
        </div>
        <div class="field"><span>Base URL</span>
          <input type="url" data-set="openai.baseUrl" value="${S.openai.baseUrl}" placeholder="https://api.openai.com/v1">
          <span class="hint">Tanpa garis miring di akhir. Contoh Ollama: http://localhost:11434/v1</span>
        </div>
        <div class="grid2">
          <div class="field"><span>API Key</span>
            <input type="password" id="apiKey" data-set="openai.apiKey" value="${S.openai.apiKey}" placeholder="sk-…">
          </div>
          <div class="field"><span>Organization (opsional)</span>
            <input type="text" data-set="openai.organization" value="${S.openai.organization || ''}" placeholder="org-…">
          </div>
        </div>
        <div class="check-row"><input type="checkbox" id="showKey"><label for="showKey">Tampilkan API key</label></div>
        <div class="admin-actions">
          <button class="btn btn-primary" id="btnTest">Tes koneksi</button>
          <button class="btn btn-ghost" id="btnModels">Ambil daftar model</button>
        </div>
        <div class="status-line" id="apiStatus">Belum dites.</div>
      </div>
      <div class="panel-card">
        <h3>Contoh cepat</h3>
        <p><strong>Ollama lokal:</strong> jalankan <span class="kbd">ollama serve</span> lalu isi base URL <span class="kbd">http://localhost:11434/v1</span> dan API key bebas (mis. <span class="kbd">ollama</span>). Buka tab Model untuk ambil daftar model.</p>
      </div>`;
    bind();
    $('showKey').addEventListener('change', (e) => { $('apiKey').type = e.target.checked ? 'text' : 'password'; });
    $('preset').addEventListener('change', (e) => {
      const v = PRESETS[e.target.value];
      if (v !== '') { S.openai.baseUrl = v; save(); viewApi(); }
      else { inner.querySelector('[data-set="openai.baseUrl"]').focus(); }
    });
    $('btnTest').addEventListener('click', async () => {
      $('apiStatus').textContent = 'Menghubungi…';
      try {
        const models = await N.listModels(S);
        statusLine('apiStatus', true, `Terhubung! Ditemukan ${models.length} model.`);
        N.toast('Koneksi OK: ' + models.length + ' model.', 'ok');
      } catch (e) { statusLine('apiStatus', false, 'Gagal: ' + e.message); N.toast('Tes gagal: ' + e.message, 'err'); }
    });
    $('btnModels').addEventListener('click', async () => {
      $('apiStatus').textContent = 'Memuat model…';
      try {
        const models = await N.listModels(S);
        $('apiStatus').innerHTML = `<span class="status-dot ok"></span>Ditemukan ${models.length} model: <span class="kbd">${models.slice(0, 12).join('</span> <span class="kbd">')}</span>${models.length > 12 ? ' …' : ''}`;
        window.__nebulaModels = models;
        N.toast(models.length + ' model dimuat. Pindah ke tab Model.', 'ok');
      } catch (e) { statusLine('apiStatus', false, 'Gagal: ' + e.message); }
    });
  }

  function viewModels() {
    const cached = window.__nebulaModels || [];
    inner.innerHTML = `
      <h1>Model &amp; Parameter</h1>
      <p class="desc">Model default untuk chat baru + parameter sampling. Perubahan tersimpan otomatis.</p>
      <div class="panel-card">
        <h3>Model default</h3>
        <p>Daftar dari hasil “Ambil daftar model” di tab API, atau ketik manual.</p>
        <div class="field"><span>Nama model</span>
          <input type="text" data-set="params.model" value="${S.params.model}" list="modelDL">
          <datalist id="modelDL">${cached.map((m) => `<option value="${m}">`).join('')}</datalist>
        </div>
        <div class="admin-actions"><button class="btn btn-ghost" id="btnReload">Muat ulang daftar model</button></div>
        <div class="status-line" id="mStatus">${cached.length ? `Cache: ${cached.length} model.` : 'Belum ada cache model.'}</div>
      </div>
      <div class="panel-card">
        <h3>Parameter sampling</h3>
        <div class="field"><span>Temperature: <output id="oTemp">${S.params.temperature}</output></span>
          <input type="range" min="0" max="2" step="0.1" data-set="params.temperature" value="${S.params.temperature}" id="rTemp">
          <span class="hint">0 = deterministik, 2 = sangat kreatif.</span>
        </div>
        <div class="grid2">
          <div class="field"><span>Max tokens</span><input type="number" min="64" max="128000" step="64" data-set="params.maxTokens" value="${S.params.maxTokens}"></div>
          <div class="field"><span>Top-P</span><input type="number" min="0" max="1" step="0.05" data-set="params.topP" value="${S.params.topP}"></div>
        </div>
      </div>
      <div class="panel-card">
        <h3>System prompt global</h3>
        <p>Kepribadian &amp; instruksi dasar untuk semua chat.</p>
        <div class="field"><span>System prompt</span>
          <textarea rows="4" data-set="params.systemPrompt">${S.params.systemPrompt}</textarea>
        </div>
      </div>`;
    bind();
    $('rTemp').addEventListener('input', (e) => { $('oTemp').textContent = e.target.value; });
    $('btnReload').addEventListener('click', async () => {
      $('mStatus').textContent = 'Memuat…';
      try {
        const models = await N.listModels(S);
        window.__nebulaModels = models;
        $('mStatus').textContent = `OK: ${models.length} model.`;
        viewModels();
      } catch (e) { $('mStatus').textContent = 'Gagal: ' + e.message; }
    });
  }

  function viewSearch() {
    const p = S.search.provider;
    inner.innerHTML = `
      <h1>Web Search</h1>
      <p class="desc">Agar AI bisa menjawab dengan info terkini + sitasi sumber. Key search terpisah dari key chat.</p>
      <div class="panel-card">
        <h3>Provider</h3>
        <div class="grid2">
          <div class="field"><span>Provider aktif</span>
            <select data-set="search.provider">
              ${['tavily', 'serper', 'brave', 'custom'].map((v) => `<option value="${v}" ${p === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><span>Max hasil</span>
            <input type="number" min="1" max="10" data-set="search.maxResults" value="${S.search.maxResults}">
          </div>
        </div>
        <div class="field"><span>API key search</span>
          <input type="password" data-set="search.apiKey" value="${S.search.apiKey}" placeholder="kunci ${p}">
          <span class="hint">Tavily: tavily.com · Serper: serper.dev · Brave: brave.com/search/api</span>
        </div>
        ${p === 'tavily' ? `<div class="field"><span>Kedalaman pencarian (Tavily)</span>
          <select data-set="search.tavilySearchDepth">
            <option value="basic" ${S.search.tavilySearchDepth === 'basic' ? 'selected' : ''}>Basic (cepat & murah)</option>
            <option value="advanced" ${S.search.tavilySearchDepth === 'advanced' ? 'selected' : ''}>Advanced (mendalam)</option>
          </select></div>` : ''}
        ${p === 'custom' ? `<div class="field"><span>Endpoint custom (POST {query, max_results})</span>
          <input type="url" data-set="search.endpoint" value="${S.search.endpoint}" placeholder="https://serverku.com/api/search">
          <span class="hint">Harus mengembalikan JSON: {"answer": "…", "results": [{"title","url","snippet"}]}</span></div>` : ''}
        <div class="field"><span>Uji query</span>
          <div class="row"><input type="text" id="testQ" value="harga bitcoin hari ini" style="flex:1"><button class="btn btn-primary btn-sm" id="btnSearchTest">Tes search</button></div>
        </div>
        <div class="status-line" id="sStatus">Belum dites.</div>
      </div>`;
    bind();
    inner.querySelector('[data-set="search.provider"]').addEventListener('change', () => { S = N.Store.load(); viewSearch(); });
    // note: bind() already saved provider change; reload S to keep consistent
    $('btnSearchTest').addEventListener('click', async () => {
      S = N.Store.load();
      $('sStatus').textContent = 'Mencari…';
      try {
        const r = await N.webSearch(S, $('testQ').value);
        statusLine('sStatus', true, `OK: ${r.results.length} hasil. Pertama: ${(r.results[0] && r.results[0].title) || '—'}`);
      } catch (e) { statusLine('sStatus', false, 'Gagal: ' + e.message); }
    });
  }

  function viewApp() {
    inner.innerHTML = `
      <h1>Aplikasi &amp; Keamanan</h1>
      <p class="desc">Perilaku default chat dan proteksi panel admin.</p>
      <div class="panel-card">
        <h3>Fitur default</h3>
        <div class="check-row"><input type="checkbox" data-set="features.searchDefault" ${S.features.searchDefault ? 'checked' : ''} id="fS"><label for="fS">Web search aktif secara default di chat baru</label></div>
        <div class="field"><span>Effort AI default</span>
          <select data-set="features.effortDefault">
            <option value="low" ${(S.features.effortDefault || 'medium') === 'low' ? 'selected' : ''}>Low — cepat &amp; ringkas</option>
            <option value="medium" ${(S.features.effortDefault || 'medium') === 'medium' ? 'selected' : ''}>Medium — seimbang</option>
            <option value="high" ${(S.features.effortDefault || 'medium') === 'high' ? 'selected' : ''}>High — mendalam &amp; teliti</option>
          </select>
          <span class="hint">Bisa diubah per chat lewat tombol ⚡ di halaman chat.</span>
        </div>
        <div class="check-row"><input type="checkbox" data-set="features.streamDefault" ${S.features.streamDefault ? 'checked' : ''} id="fSt"><label for="fSt">Streaming token default aktif</label></div>
        <div class="check-row"><input type="checkbox" data-set="features.titleAuto" ${S.features.titleAuto ? 'checked' : ''} id="fT"><label for="fT">Judul chat otomatis dari pesan pertama</label></div>
      </div>
      <div class="panel-card">
        <h3>Kunci panel admin</h3>
        <p>Jika diisi, panel admin meminta password ini setiap dibuka. Kosongkan untuk menonaktifkan.</p>
        <div class="field"><span>Password admin</span>
          <input type="password" data-set="adminPass" value="${S.adminPass || ''}" placeholder="(kosong = tanpa kunci)">
        </div>
      </div>`;
    bind();
  }

  function viewData() {
    const chats = N.Chats.load();
    const kb = Math.round((localStorage.getItem(N.CHAT_KEY) || '').length / 1024);
    inner.innerHTML = `
      <h1>Data</h1>
      <p class="desc">${chats.length} percakapan tersimpan (~${kb} KB) — semua lokal di browser ini.</p>
      <div class="panel-card">
        <h3>Backup &amp; restore</h3>
        <p>Unduh seluruh data (pengaturan + semua chat) atau kembalikan dari file backup.</p>
        <div class="admin-actions">
          <button class="btn btn-ghost" id="btnBackup">⤓ Backup semua</button>
          <button class="btn btn-ghost" id="btnRestore">⤒ Restore</button>
          <input type="file" id="restoreFile" accept=".json" style="display:none">
        </div>
      </div>
      <div class="panel-card">
        <h3>Zona berbahaya</h3>
        <div class="admin-actions">
          <button class="btn btn-danger" id="btnWipeChats">Hapus semua chat</button>
          <button class="btn btn-danger" id="btnWipeAll">Reset total (pengaturan + chat)</button>
        </div>
      </div>`;
    $('btnBackup').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ settings: S, chats: N.Chats.load(), at: Date.now() }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'nebula-backup.json';
      a.click();
    });
    $('btnRestore').addEventListener('click', () => $('restoreFile').click());
    $('restoreFile').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          if (d.settings) { S = d.settings; N.Store.save(S); }
          if (d.chats) N.Chats.save(d.chats);
          N.toast('Restore berhasil.', 'ok');
          setTimeout(() => location.reload(), 600);
        } catch { N.toast('File backup tidak valid.', 'err'); }
      };
      r.readAsText(f);
    });
    $('btnWipeChats').addEventListener('click', () => {
      if (confirm('Hapus SEMUA chat?')) { N.Chats.save([]); N.toast('Semua chat dihapus.', 'ok'); viewData(); }
    });
    $('btnWipeAll').addEventListener('click', () => {
      if (confirm('Reset TOTAL? Pengaturan & chat hilang.')) { S = N.Store.reset(); N.Chats.save([]); location.reload(); }
    });
  }

  function render() {
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
    ({ api: viewApi, models: viewModels, search: viewSearch, app: viewApp, data: viewData })[tab]();
  }

  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.getAttribute('data-tab'); render(); }));
  $('btnToggle').addEventListener('click', () => $('sidebar').classList.toggle('hidden'));
  $('btnToggle2').addEventListener('click', () => $('sidebar').classList.toggle('hidden'));

  // admin lock
  if (S.adminPass && !sessionStorage.getItem('nebula_admin_ok')) {
    const p = prompt('Panel admin terkunci. Masukkan password:');
    if (p !== S.adminPass) { location.href = 'app.html'; return; }
    sessionStorage.setItem('nebula_admin_ok', '1');
  }
  render();
  if (window.innerWidth < 860) $('sidebar').classList.add('hidden');
})();
