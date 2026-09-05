/* NebulaChat app: threads, streaming, search, voice, attachments, prompts, share, export. */
(function () {
  'use strict';
  const N = window.Nebula;
  let settings = N.Store.load();
  let chats = N.Chats.load();
  let activeId = null;
  let aborter = null;
  let searchOn = !!settings.features.searchDefault;
  let effort = settings.features.effortDefault || 'medium';
  let attachments = []; // {kind:'image'|'text', name, dataUrl?, text?}
  let sessionTokens = { in: 0, out: 0 };

  const $ = (id) => document.getElementById(id);
  const threadInner = $('threadInner'), thread = $('thread'), input = $('input');

  // ---------- helpers ----------
  function active() { return chats.find((c) => c.id === activeId); }
  function persist() { N.Chats.save(chats); }
  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function refreshUsage() {
    $('usageLine').textContent = `${sessionTokens.in + sessionTokens.out} token sesi ini`;
  }

  // ---------- sidebar ----------
  function renderList(filter) {
    const box = $('chatList');
    box.innerHTML = '';
    const q = (filter || '').toLowerCase();
    const pinned = chats.filter((c) => c.pinned && (!q || c.title.toLowerCase().includes(q)));
    const rest = chats.filter((c) => !c.pinned && (!q || c.title.toLowerCase().includes(q) || c.messages.some((m) => String(m.content || '').toLowerCase().includes(q))));
    function sec(title, arr) {
      if (!arr.length) return;
      const s = document.createElement('div');
      s.className = 'side-sec'; s.textContent = title;
      box.appendChild(s);
      arr.forEach((c) => {
        const b = document.createElement('div');
        b.className = 'chat-item' + (c.id === activeId ? ' active' : '');
        b.setAttribute('role', 'button');
        b.tabIndex = 0;
        b.innerHTML = `<span class="t">${escHtml(c.title || 'Chat tanpa judul')}</span>${c.pinned ? '<span class="pin">📌</span>' : ''}<button class="x" title="Hapus">×</button>`;
        b.addEventListener('click', (e) => {
          if (e.target.classList.contains('x')) {
            chats = chats.filter((x) => x.id !== c.id);
            if (activeId === c.id) newChat();
            persist(); renderList($('searchChats').value);
            return;
          }
          activeId = c.id; persist(); renderList($('searchChats').value); renderThread();
          if (window.innerWidth < 860) $('sidebar').classList.add('hidden');
        });
        b.addEventListener('keydown', (e) => { if (e.key === 'Enter') b.click(); });
        b.addEventListener('dblclick', () => {
          const t = prompt('Nama chat:', c.title);
          if (t) { c.title = t.slice(0, 80); c.updatedAt = Date.now(); persist(); renderList($('searchChats').value); }
        });
        box.appendChild(b);
      });
    }
    if (!pinned.length && !rest.length) {
      box.innerHTML = '<div class="side-sec">Belum ada chat</div>';
      return;
    }
    sec('Dipin', pinned);
    sec(pinned.length ? 'Lainnya' : 'Riwayat', rest);
  }

  function newChat() {
    const c = { id: N.uid(), title: 'Chat baru', createdAt: Date.now(), updatedAt: Date.now(), pinned: false, messages: [] };
    chats.unshift(c);
    activeId = c.id;
    persist(); renderList($('searchChats').value); renderThread();
    input.focus();
  }

  // ---------- thread rendering ----------
  function renderThread() {
    const c = active();
    threadInner.innerHTML = '';
    if (!c || !c.messages.length) {
      threadInner.innerHTML = `
        <div class="welcome">
          <div class="orb"></div>
          <h2>Halo, mau tanya apa hari ini?</h2>
          <p>Didukung <strong>${escHtml(settings.params.model)}</strong> · ⚡${escHtml(N.getEffort(effort).label)}${searchOn ? ' · mode <strong>web search aktif</strong>' : ''}. ${settings.openai.apiKey ? '' : 'Belum ada API key — <a href="admin.html">atur di Panel Admin</a>.'}</p>
          <div class="suggest">
            <button data-q="Jelaskan konsep black hole dengan bahasa sederhana untuk pemula.">🕳 Jelaskan black hole untuk pemula</button>
            <button data-q="Buatkan draf email profesional untuk follow-up lamaran kerja.">✉️ Draf email follow-up lamaran</button>
            <button data-q="Tulis fungsi JavaScript untuk debounce beserta contoh penggunaannya.">💻 Contoh fungsi debounce di JS</button>
            <button data-q="Berikan 5 ide konten edukasi teknologi untuk minggu ini.">💡 5 ide konten teknologi</button>
          </div>
        </div>`;
      threadInner.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
        input.value = b.getAttribute('data-q');
        send();
      }));
      return;
    }
    c.messages.forEach((m, i) => threadInner.appendChild(msgEl(m, i)));
    thread.scrollTop = thread.scrollHeight;
  }

  function msgEl(m, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
    if (m.role === 'user') {
      let imgs = '';
      (m.images || []).forEach((src) => { imgs += `<img src="${src}" alt="lampiran" style="max-width:220px;border-radius:10px;margin-bottom:.4rem">`; });
      wrap.innerHTML = `<div class="avatar">🧑</div><div class="body"><div class="who">Kamu</div><div class="bubble">${imgs}${escHtml(m.content)}</div></div>`;
      return wrap;
    }
    const body = document.createElement('div');
    body.className = 'body';
    const who = document.createElement('div');
    who.className = 'who'; who.textContent = 'NebulaChat';
    const content = document.createElement('div');
    content.className = 'content';
    content.innerHTML = window.renderMarkdown(m.content || '');
    const meta = document.createElement('div');
    meta.className = 'meta';
    let costTxt = '';
    if (m.usage) {
      const cost = N.estimateCost(m.model, m.usage.in, m.usage.out);
      costTxt = ` · ${m.usage.in}→${m.usage.out} tok` + (cost != null ? ` · ~$${cost.toFixed(4)}` : '');
    }
    meta.innerHTML = `<span>${escHtml(m.model || '')}${m.effort ? ' · ⚡' + escHtml(N.getEffort(m.effort).label) : ''}${costTxt}</span>`;
    const acts = document.createElement('span');
    acts.className = 'acts';
    acts.innerHTML = `<button class="mini-btn" data-act="copy">Salin</button>
      <button class="mini-btn" data-act="retry">↻</button>
      <button class="mini-btn" data-act="tts">🔊</button>
      <button class="mini-btn" data-act="fb-good">👍</button>
      <button class="mini-btn" data-act="fb-bad">👎</button>`;
    acts.addEventListener('click', (e) => {
      const a = e.target.getAttribute('data-act');
      if (!a) return;
      if (a === 'copy') { navigator.clipboard.writeText(m.content || ''); N.toast('Disalin', 'ok'); }
      if (a === 'retry') regenerate(idx);
      if (a === 'tts') speak(m.content || '');
      if (a === 'fb-good' || a === 'fb-bad') { m.feedback = a; persist(); N.toast('Makasih atas penilaianmu!', 'ok'); }
    });
    meta.appendChild(acts);
    body.appendChild(who); body.appendChild(content); body.appendChild(meta);
    if (m.sources && m.sources.length) {
      const det = document.createElement('details');
      det.className = 'sources';
      det.innerHTML = `<summary>Sumber web (${m.sources.length})</summary>` +
        m.sources.map((s, i) => `<div>[${i + 1}] <a href="${escHtml(s.url)}" target="_blank" rel="noopener">${escHtml(s.title)}</a></div>`).join('');
      body.appendChild(det);
    }
    const av = document.createElement('div');
    av.className = 'avatar';
    wrap.appendChild(av); wrap.appendChild(body);
    return wrap;
  }

  // ---------- send flow ----------
  function apiMessages(c, upto) {
    return c.messages.slice(0, upto == null ? undefined : upto)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        if (m.role === 'user' && m.images && m.images.length) {
          const parts = [{ type: 'text', text: m.content }];
          m.images.forEach((src) => parts.push({ type: 'image_url', image_url: { url: src } }));
          return { role: 'user', content: parts };
        }
        return { role: m.role, content: m.content };
      });
  }

  async function send() {
    const text = input.value.trim();
    if ((!text && !attachments.length) || aborter) return;
    if (!settings.openai.apiKey && !settings.openai.baseUrl.includes('localhost') && !settings.openai.baseUrl.includes('127.0.0.1')) {
      N.toast('API key belum diisi. Buka Panel Admin dulu.', 'err');
      return;
    }
    let c = active();
    if (!c) { newChat(); c = active(); }

    const imgs = attachments.filter((a) => a.kind === 'image').map((a) => a.dataUrl);
    const txtCtx = attachments.filter((a) => a.kind === 'text').map((a) => `[Lampiran ${a.name}]\n${a.text}`).join('\n\n');
    const fullText = (txtCtx ? txtCtx + '\n\n' : '') + text;
    c.messages.push({ role: 'user', content: fullText || '(lampiran)', images: imgs, ts: Date.now() });
    attachments = []; renderAttach();
    input.value = ''; autosize();
    c.updatedAt = Date.now();
    if (settings.features.titleAuto && c.messages.length <= 2 && c.title === 'Chat baru') {
      c.title = (text || 'Chat lampiran').slice(0, 60);
    }
    persist(); renderList($('searchChats').value); renderThread();
    await runAssistant(c);
  }

  async function runAssistant(c, uptoIdx) {
    const btnSend = $('btnSend');
    aborter = new AbortController();
    btnSend.outerHTML = '<button class="stop-btn" id="btnSend" title="Berhenti">■ Stop</button>';
    $('btnSend').addEventListener('click', () => aborter.abort());

    // typing indicator
    const tWrap = document.createElement('div');
    tWrap.className = 'msg assistant';
    tWrap.innerHTML = '<div class="avatar"></div><div class="body"><div class="who">NebulaChat</div><div class="typing"><i></i><i></i><i></i></div></div>';
    threadInner.appendChild(tWrap);
    thread.scrollTop = thread.scrollHeight;

    let sources = [];
    let msgs = apiMessages(c, uptoIdx);
    try {
      // web search augmentation (jumlah hasil mengikuti effort)
      if (searchOn) {
        const lastUser = [...c.messages].reverse().find((m) => m.role === 'user');
        const eff = N.getEffort(effort);
        const sd = await N.webSearch(settings, lastUser ? lastUser.content : '', { maxResults: eff.searchResults });
        sources = sd.results || [];
        const ctx = N.buildSearchContext(sd, eff.searchChars);
        msgs = [...msgs.slice(0, -1), {
          role: 'user',
          content: `Konteks hasil pencarian web (jawab BERDASARKAN ini bila relevan, dan sebutkan sumbernya dengan format [1], [2], dst):\n\n${ctx}\n\nPertanyaan: ${lastUser ? lastUser.content : ''}`
        }];
      }
      let full = '';
      const startLen = threadInner.children.length;
      const result = await N.chatCompletion(settings, msgs, { model: settings.params.model, effort }, (delta, done) => {
        if (done) return;
        full += delta;
        let contentEl = tWrap.querySelector('.content');
        if (!contentEl) {
          tWrap.querySelector('.body').innerHTML = '<div class="who">NebulaChat</div><div class="content"></div>';
          contentEl = tWrap.querySelector('.content');
        }
        contentEl.innerHTML = window.renderMarkdown(full);
        if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 220) thread.scrollTop = thread.scrollHeight;
      }, aborter.signal);

      const inTok = N.estimateTokens(JSON.stringify(msgs));
      const outTok = N.estimateTokens(result.text);
      sessionTokens.in += inTok; sessionTokens.out += outTok;
      refreshUsage();
      if (uptoIdx != null) c.messages = c.messages.slice(0, uptoIdx); // drop old answer on retry
      c.messages.push({
        role: 'assistant', content: result.text, model: settings.params.model,
        effort,
        usage: result.usage ? { in: result.usage.prompt_tokens, out: result.usage.completion_tokens } : { in: inTok, out: outTok },
        sources, ts: Date.now()
      });
      c.updatedAt = Date.now();
      persist(); renderList($('searchChats').value); renderThread();
    } catch (err) {
      tWrap.remove();
      if (err.name === 'AbortError') {
        N.toast('Dihentikan.', '');
      } else {
        const eWrap = document.createElement('div');
        eWrap.className = 'msg assistant';
        eWrap.innerHTML = `<div class="avatar"></div><div class="body"><div class="who">NebulaChat</div>
          <div class="bubble" style="border:1px solid rgba(248,113,113,.5);border-radius:12px;padding:.7rem .95rem">⚠️ ${escHtml(err.message)}<br><br>
          <button class="mini-btn" id="errRetry">Coba lagi</button> <a class="mini-btn" href="admin.html" style="text-decoration:none">Cek Panel Admin</a></div></div>`;
        threadInner.appendChild(eWrap);
        eWrap.querySelector('#errRetry').addEventListener('click', () => { eWrap.remove(); runAssistant(c, uptoIdx); });
        thread.scrollTop = thread.scrollHeight;
      }
    } finally {
      aborter = null;
      const sb = $('btnSend');
      if (sb) sb.outerHTML = '<button class="send-btn" id="btnSend" title="Kirim">↑</button>';
      $('btnSend').addEventListener('click', send);
    }
  }

  function regenerate(assistantIdx) {
    const c = active();
    if (!c || aborter) return;
    // run assistant replacing message at assistantIdx: upto = assistantIdx (exclude it)
    runAssistant(c, assistantIdx);
  }

  // ---------- attachments ----------
  function renderAttach() {
    const box = $('attachPreview');
    box.innerHTML = '';
    attachments.forEach((a, i) => {
      const chip = document.createElement('div');
      chip.className = 'attach-chip';
      chip.innerHTML = `${a.kind === 'image' ? `<img src="${a.dataUrl}" alt="">` : '📄'}<span>${escHtml(a.name)}</span><button title="Hapus">×</button>`;
      chip.querySelector('button').addEventListener('click', () => { attachments.splice(i, 1); renderAttach(); });
      box.appendChild(chip);
    });
  }

  // ---------- voice ----------
  function speak(text) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[#*`>|[\]]/g, '').slice(0, 2000));
      u.lang = 'id-ID';
      speechSynthesis.speak(u);
    } catch { N.toast('TTS tidak didukung browser ini.', 'err'); }
  }

  // ---------- prompt library ----------
  const BUILTIN_PROMPTS = [
    { t: 'Ringkas teks', p: 'Ringkas teks berikut menjadi poin-poin penting dalam Bahasa Indonesia:\n\n' },
    { t: 'Perbaiki tulisan', p: 'Perbaiki tata bahasa, ejaan, dan gaya tulisan berikut agar profesional. Tampilkan hasil akhirnya saja:\n\n' },
    { t: 'Jelaskan kode', p: 'Jelaskan kode berikut baris per baris dengan bahasa sederhana:\n\n' },
    { t: 'Ide konten', p: 'Berikan 10 ide konten menarik tentang topik berikut, lengkap dengan hook pembuka:\n\n' },
    { t: 'Draf email', p: 'Buatkan draf email profesional untuk keperluan berikut. Sertakan subjek:\n\n' },
    { t: 'Latihan interview', p: 'Bertindaklah sebagai interviewer. Ajukan satu pertanyaan interview tentang topik berikut, tunggu jawabanku, lalu beri feedback:\n\n' }
  ];
  function customPrompts() {
    try { return JSON.parse(localStorage.getItem('nebula_prompts_v1') || '[]'); }
    catch { return []; }
  }
  function openPrompts() {
    const all = [...BUILTIN_PROMPTS.map((p) => ({ ...p, builtin: true })), ...customPrompts()];
    openModal('Perpustakaan Prompt', `
      <div class="row" style="margin-bottom:.9rem">
        <input type="text" id="npTitle" placeholder="Judul prompt baru…" style="flex:1">
        <button class="btn btn-ghost btn-sm" id="npAdd">+ Tambah</button>
      </div>
      <div id="promptList">${all.map((p, i) => `<div class="prompt-item"><h4>${escHtml(p.t)}</h4><p>${escHtml(p.p.slice(0, 120))}…</p><div class="row"><button class="mini-btn" data-use="${i}">Gunakan</button>${p.builtin ? '' : `<button class="mini-btn" data-del="${p.t}">Hapus</button>`}</div></div>`).join('')}</div>
      <textarea id="npBody" rows="2" placeholder="Isi prompt baru…" style="margin-top:.4rem"></textarea>`);
    $('npAdd').addEventListener('click', () => {
      const t = $('npTitle').value.trim(), b = $('npBody').value.trim();
      if (!t || !b) { N.toast('Isi judul dan isi prompt.', 'err'); return; }
      const arr = customPrompts(); arr.push({ t, p: b });
      localStorage.setItem('nebula_prompts_v1', JSON.stringify(arr));
      closeModal(); openPrompts();
    });
    $('promptList').addEventListener('click', (e) => {
      const u = e.target.getAttribute('data-use');
      const d = e.target.getAttribute('data-del');
      if (u != null) { input.value = all[+u].p; closeModal(); input.focus(); autosize(); }
      if (d) {
        localStorage.setItem('nebula_prompts_v1', JSON.stringify(customPrompts().filter((x) => x.t !== d)));
        closeModal(); openPrompts();
      }
    });
  }

  // ---------- models modal ----------
  let cachedModels = null;
  async function openModels() {
    openModal('Pilih Model', '<p style="color:var(--muted);font-size:.88rem">Memuat daftar model…</p>');
    try {
      cachedModels = await N.listModels(settings);
    } catch (e) {
      document.querySelector('.modal-body').innerHTML =
        `<p>⚠️ Gagal memuat daftar model: ${escHtml(e.message)}</p>
         <p style="color:var(--muted);font-size:.88rem">Kamu tetap bisa mengetik nama model manual di bawah (mis. <span class="kbd">gpt-4o-mini</span>) atau perbaiki koneksi di Panel Admin.</p>
         <div class="row"><input type="text" id="manualModel" value="${escHtml(settings.params.model)}" style="flex:1"><button class="btn btn-primary btn-sm" id="manualSet">Pakai</button></div>`;
      $('manualSet').addEventListener('click', () => {
        settings.params.model = $('manualModel').value.trim() || settings.params.model;
        N.Store.save(settings); syncModelLabel(); closeModal();
      });
      return;
    }
    const body = document.querySelector('.modal-body');
    body.innerHTML = `<div class="row" style="margin-bottom:.8rem"><input type="text" id="modelFilter" placeholder="Filter model…" style="flex:1"></div>
      <div id="modelList"></div>`;
    function draw(f) {
      $('modelList').innerHTML = cachedModels.filter((m) => m.toLowerCase().includes(f.toLowerCase())).slice(0, 100)
        .map((m) => `<button class="model-item" data-m="${escHtml(m)}"><span class="dot"></span><span><strong>${escHtml(m)}</strong><small>${m === settings.params.model ? '✓ aktif' : ''}</small></span></button>`).join('')
        || '<p style="color:var(--dim)">Tidak ada yang cocok.</p>';
    }
    draw('');
    $('modelFilter').addEventListener('input', (e) => draw(e.target.value));
    $('modelList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      settings.params.model = b.getAttribute('data-m');
      N.Store.save(settings); syncModelLabel(); closeModal();
      N.toast('Model: ' + settings.params.model, 'ok');
    });
  }

  // ---------- modal + command palette ----------
  function openModal(title, bodyHtml) {
    closeModal();
    const root = $('modalRoot');
    const ov = document.createElement('div');
    ov.className = 'overlay'; ov.id = 'overlay';
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${escHtml(title)}">
      <div class="modal-head"><h3>${escHtml(title)}</h3><button class="icon-btn" id="modalX">×</button></div>
      <div class="modal-body">${bodyHtml}</div></div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) closeModal(); });
    root.appendChild(ov);
    $('modalX').addEventListener('click', closeModal);
  }
  function closeModal() { $('overlay')?.remove(); }

  const COMMANDS = [
    { t: 'Chat baru', d: 'mulai percakapan kosong', fn: newChat },
    { t: 'Pilih model', d: 'ganti model AI', fn: openModels },
    { t: 'Toggle web search', d: 'nyalakan/matikan pencarian', fn: () => $('btnSearch').click() },
    { t: 'Effort: Low', d: 'jawaban cepat & ringkas', fn: () => setEffort('low') },
    { t: 'Effort: Medium', d: 'jawaban seimbang', fn: () => setEffort('medium') },
    { t: 'Effort: High', d: 'jawaban mendalam & teliti', fn: () => setEffort('high') },
    { t: 'Perpustakaan prompt', d: 'template prompt', fn: openPrompts },
    { t: 'Ekspor chat (Markdown)', d: 'unduh .md', fn: () => exportChat('md') },
    { t: 'Ekspor chat (JSON)', d: 'unduh .json', fn: () => exportChat('json') },
    { t: 'Bagikan chat', d: 'salin tautan berisi chat', fn: shareChat },
    { t: 'Pin chat ini', d: 'sematkan ke atas', fn: () => { const c = active(); if (c) { c.pinned = !c.pinned; persist(); renderList(); } } },
    { t: 'Hapus chat ini', d: 'tidak bisa dibatalkan', fn: () => { if (confirm('Hapus chat ini?')) { chats = chats.filter((x) => x.id !== activeId); newChat(); persist(); } } },
    { t: 'Panel admin', d: 'pengaturan API & model', fn: () => location.href = 'admin.html' }
  ];
  function openCmd() {
    openModal('Perintah', '<input class="cmd-input" id="cmdQ" placeholder="Ketik perintah…" aria-label="Ketik perintah"><div id="cmdList" style="margin-top:.5rem"></div>');
    const q = $('cmdQ'), list = $('cmdList');
    let sel = 0, items = COMMANDS;
    function draw() {
      list.innerHTML = '';
      items.forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'cmd-item' + (i === sel ? ' sel' : '');
        b.innerHTML = `${escHtml(c.t)}<small>${escHtml(c.d)}</small>`;
        b.addEventListener('click', () => { closeModal(); c.fn(); });
        list.appendChild(b);
      });
    }
    draw(); q.focus();
    q.addEventListener('input', () => {
      items = COMMANDS.filter((c) => (c.t + c.d).toLowerCase().includes(q.value.toLowerCase()));
      sel = 0; draw();
    });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && items[sel]) { closeModal(); items[sel].fn(); }
    });
  }

  // ---------- export / share ----------
  function exportChat(fmt) {
    const c = active();
    if (!c || !c.messages.length) { N.toast('Belum ada isi untuk diekspor.', 'err'); return; }
    let out, name, type;
    if (fmt === 'json') {
      out = JSON.stringify(c, null, 2); name = (c.title || 'chat') + '.json'; type = 'application/json';
    } else {
      out = '# ' + c.title + '\n\n' + c.messages.map((m) =>
        m.role === 'user' ? `**Kamu:** ${m.content}` : `**NebulaChat (${m.model || ''}):**\n\n${m.content}`).join('\n\n---\n\n');
      name = (c.title || 'chat') + '.md'; type = 'text/markdown';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type }));
    a.download = name.replace(/[\\/:*?"<>|]/g, '-');
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function shareChat() {
    const c = active();
    if (!c || !c.messages.length) { N.toast('Belum ada isi untuk dibagikan.', 'err'); return; }
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ t: c.title, m: c.messages.slice(-20) }))));
    const url = location.origin + location.pathname + '#share=' + payload;
    navigator.clipboard.writeText(url).then(() => N.toast('Tautan dibagikan (20 pesan terakhir).', 'ok'));
  }

  function importShared() {
    if (!location.hash.startsWith('#share=')) return;
    try {
      const d = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(7)))));
      const c = { id: N.uid(), title: (d.t || 'Chat dibagikan') + ' (salinan)', createdAt: Date.now(), updatedAt: Date.now(), pinned: false, messages: d.m || [] };
      chats.unshift(c); activeId = c.id;
      persist(); history.replaceState(null, '', location.pathname);
      N.toast('Chat dibagikan berhasil dimuat.', 'ok');
    } catch { N.toast('Tautan bagikan tidak valid.', 'err'); }
  }

  // ---------- misc UI ----------
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }
  function syncModelLabel() {
    $('modelName').textContent = settings.params.model;
    $('footModel').textContent = settings.params.model;
    $('footModel').textContent = settings.params.model + ' · ⚡' + N.getEffort(effort).label;
    $('effortLabel').textContent = N.getEffort(effort).label;
    document.querySelectorAll('#effortMenu [data-effort]').forEach((b) =>
      b.setAttribute('aria-selected', String(b.getAttribute('data-effort') === effort)));
    const dot = $('apiDot');
    dot.className = 'status-dot ' + (settings.openai.apiKey ? 'ok' : '');
    dot.title = settings.openai.apiKey ? 'API key terisi' : 'API key kosong';
  }

  function setEffort(e) {
    effort = N.getEffort(e) ? e : 'medium';
    syncModelLabel();
    N.toast('Effort AI: ' + N.getEffort(effort).label, 'ok');
  }

  // ---------- events ----------
  $('btnSend').addEventListener('click', send);
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('btnToggle').addEventListener('click', () => $('sidebar').classList.toggle('hidden'));
  $('btnToggle2').addEventListener('click', () => $('sidebar').classList.toggle('hidden'));
  $('btnNew').addEventListener('click', newChat);
  $('searchChats').addEventListener('input', (e) => renderList(e.target.value));
  $('btnModel').addEventListener('click', openModels);
  $('btnEffort').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('effortMenu');
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', () => { const m = $('effortMenu'); if (m) m.hidden = true; });
  $('effortMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-effort]');
    if (!b) return;
    setEffort(b.getAttribute('data-effort'));
    $('effortMenu').hidden = true;
  });
  $('btnSearch').addEventListener('click', () => {
    searchOn = !searchOn;
    $('btnSearch').setAttribute('aria-pressed', String(searchOn));
    N.toast(searchOn ? 'Web search AKTIF.' : 'Web search mati.', searchOn ? 'ok' : '');
    renderThread();
  });
  $('btnPrompt').addEventListener('click', openPrompts);
  $('btnCmd').addEventListener('click', openCmd);
  $('btnExport').addEventListener('click', () => exportChat('md'));
  $('btnShare').addEventListener('click', shareChat);
  $('btnRegen').addEventListener('click', () => {
    const c = active();
    if (!c) return;
    const lastA = c.messages.map((m, i) => m.role === 'assistant' ? i : -1).filter((i) => i >= 0).pop();
    if (lastA == null) { N.toast('Belum ada jawaban untuk diulang.', 'err'); return; }
    regenerate(lastA);
  });
  $('btnAttachImg').addEventListener('click', () => $('fileImg').click());
  $('btnAttachFile').addEventListener('click', () => $('fileTxt').click());
  $('fileImg').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      // downscale besar
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        const sc = Math.min(1, 1024 / Math.max(img.width, img.height));
        cv.width = img.width * sc; cv.height = img.height * sc;
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        attachments.push({ kind: 'image', name: f.name, dataUrl: cv.toDataURL('image/jpeg', 0.85) });
        renderAttach();
      };
      img.src = r.result;
    };
    r.readAsDataURL(f);
    e.target.value = '';
  });
  $('fileTxt').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      attachments.push({ kind: 'text', name: f.name, text: String(r.result).slice(0, 20000) });
      renderAttach();
    };
    r.readAsText(f);
    e.target.value = '';
  });
  // voice input
  $('btnVoice').addEventListener('click', () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { N.toast('Browser tidak mendukung input suara.', 'err'); return; }
    const rec = new SR();
    rec.lang = 'id-ID';
    N.toast('Mendengarkan… bicara sekarang.');
    rec.onresult = (e) => {
      input.value += (input.value ? ' ' : '') + e.results[0][0].transcript;
      autosize(); input.focus();
    };
    rec.onerror = () => N.toast('Gagal mengenali suara.', 'err');
    rec.start();
  });
  // copy code buttons (delegated)
  threadInner.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy-code]');
    if (!b) return;
    const blk = window.__codeBlocks[+b.getAttribute('data-copy-code')];
    if (blk) navigator.clipboard.writeText(blk.code).then(() => N.toast('Kode disalin.', 'ok'));
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmd(); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat(); }
    if (e.key === 'Escape') closeModal();
  });

  // ---------- init ----------
  settings = N.Store.load();
  $('btnSearch').setAttribute('aria-pressed', String(searchOn));
  syncModelLabel(); refreshUsage();
  importShared();
  if (!chats.length || !active()) newChat();
  else { activeId = chats[0].id; renderList(''); renderThread(); }
  renderList('');
  if (window.innerWidth < 860) $('sidebar').classList.add('hidden');
})();
