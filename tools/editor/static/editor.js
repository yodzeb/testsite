(function () {
  'use strict';
  const TOKEN = document.querySelector('meta[name=token]').content;
  const main = document.getElementById('main');
  let SCHEMA = {};
  const state = { view: null, item: null, dirty: false };

  // ---------- utilitaires ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return el;
  }

  async function api(method, url, body) {
    const opts = { method, headers: { 'X-Token': TOKEN } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await fetch(url, opts);
    let data = {};
    try { data = await r.json(); } catch (e) { /* réponse non JSON */ }
    if (!r.ok) throw new Error(data.error || ('Erreur ' + r.status));
    return data;
  }

  let toastTimer;
  function toast(msg, bad) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, bad ? 6000 : 2800);
  }

  function leaveOk() {
    return !state.dirty || confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?');
  }

  async function refreshBadge() {
    try {
      const s = await api('GET', '/api/git/status');
      const b = document.getElementById('badge');
      const n = s.available ? s.changes.length : 0;
      b.hidden = n === 0;
      b.textContent = n;
    } catch (e) { /* Git absent : pas de pastille */ }
  }

  // ---------- navigation ----------
  function go(view) {
    if (!leaveOk()) return;
    state.dirty = false;
    state.view = view;
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    if (view === 'settings') return viewSettings();
    if (view === 'publish') return viewPublish();
    return viewList(view);
  }

  // ---------- listes ----------
  async function viewList(coll) {
    const meta = SCHEMA[coll];
    const items = await api('GET', '/api/items/' + coll);
    const search = h('input', { type: 'search', placeholder: 'Rechercher…' });
    const list = h('div', { class: 'list' });
    const draw = () => {
      const q = search.value.toLowerCase();
      list.replaceChildren(...items.filter(i => i.title.toLowerCase().includes(q)).map(i =>
        h('div', { class: 'row', onclick: () => openEditor(i.path) },
          h('span', { class: 't' }, i.title),
          i.draft && h('span', { class: 'tag draft' }, 'Brouillon'),
          i.categorie && h('span', { class: 'tag' }, i.categorie),
          h('span', { class: 'd' }, i.date))));
      if (!list.children.length) list.append(h('p', { class: 'muted' }, 'Rien à afficher.'));
    };
    search.addEventListener('input', draw);
    const canCreate = coll !== 'pages';
    main.replaceChildren(
      h('h2', {}, meta.label),
      h('div', { class: 'bar' },
        canCreate && h('button', { class: 'btn', onclick: () => createItem(coll) }, '+ Nouvel·le ' + meta.singular),
        h('div', { class: 'grow' }, search)),
      list);
    draw();
  }

  async function createItem(coll) {
    const title = prompt('Titre :');
    if (!title || !title.trim()) return;
    try {
      const item = await api('POST', '/api/create', { collection: coll, title: title.trim() });
      toast('Créé en brouillon.');
      refreshBadge();
      openEditor(item.path);
    } catch (e) { toast(e.message, true); }
  }

  // ---------- éditeur ----------
  async function openEditor(path) {
    if (!leaveOk()) return;
    const item = await api('GET', '/api/item?path=' + encodeURIComponent(path));
    state.item = item;
    state.dirty = false;
    const coll = item.collection;
    const schema = SCHEMA[coll].fields;
    const inputs = {};
    const markDirty = () => { state.dirty = true; saveBtn.textContent = 'Enregistrer •'; };

    const form = h('div', { class: 'card' });
    for (const f of schema) {
      const v = item.fields[f.key];
      let el;
      if (f.type === 'textarea') el = h('textarea', { rows: 3 });
      else if (f.type === 'date') el = h('input', { type: 'date' });
      else if (f.type === 'url') el = h('input', { type: 'url', placeholder: 'https://…' });
      else if (f.type === 'bool') el = h('input', { type: 'checkbox' });
      else if (f.type === 'image') el = h('select', {});
      else el = h('input', { type: 'text' });
      if (f.type === 'bool') el.checked = !!v;
      else if (f.type === 'tags') el.value = (v || []).join(', ');
      else if (f.type !== 'image') el.value = v || '';
      el.addEventListener('input', markDirty);
      el.addEventListener('change', markDirty);
      inputs[f.key] = el;
      form.append(f.type === 'bool'
        ? h('label', { class: 'check' }, el, f.label)
        : h('label', {}, f.label, el));
    }
    const fillCover = () => {
      const sel = inputs.image;
      if (!sel) return;
      const cur = sel.dataset.v !== undefined ? sel.dataset.v : (item.fields.image || '');
      const names = state.item.images;
      sel.replaceChildren(h('option', { value: '' }, '(aucune)'),
        ...names.map(n => h('option', { value: n }, n)));
      if (cur && !names.includes(cur)) sel.append(h('option', { value: cur }, cur + ' (introuvable)'));
      sel.value = cur;
      sel.dataset.v = cur;
    };
    if (inputs.image) inputs.image.addEventListener('change', () => { inputs.image.dataset.v = inputs.image.value; });
    const extra = h('textarea', { rows: 4, spellcheck: 'false' });
    extra.value = item.extra;
    extra.addEventListener('input', markDirty);
    form.append(h('details', {}, h('summary', {}, 'Champs avancés'),
      h('p', { class: 'muted' }, 'Autres informations de l\'en-tête (format « clé: valeur »). À modifier avec précaution.'), extra));

    // zone d'écriture
    const body = h('textarea', { id: 'body', spellcheck: 'true' });
    body.value = item.body;
    const preview = h('div', { class: 'preview' });
    let pt;
    const refreshPreview = () => {
      clearTimeout(pt);
      pt = setTimeout(async () => {
        try { preview.innerHTML = (await api('POST', '/api/preview', { body: body.value, path: state.item.path })).html; } catch (e) { /* ignoré */ }
      }, 350);
    };
    body.addEventListener('input', () => { markDirty(); refreshPreview(); });

    const wrap = (a, b, ph) => {
      const s = body.selectionStart, e = body.selectionEnd;
      const sel = body.value.slice(s, e) || ph;
      body.setRangeText(a + sel + b, s, e, 'end');
      body.setSelectionRange(s + a.length, s + a.length + sel.length);
      body.focus(); markDirty(); refreshPreview();
    };
    const prefix = (p) => {
      const s = body.selectionStart;
      const start = body.value.lastIndexOf('\n', s - 1) + 1;
      body.setRangeText(p, start, start, 'end');
      body.focus(); markDirty(); refreshPreview();
    };
    const insertText = (t) => {
      body.setRangeText(t, body.selectionStart, body.selectionEnd, 'end');
      body.focus(); markDirty(); refreshPreview();
    };
    const tb = h('div', { class: 'toolbar' },
      h('button', { type: 'button', title: 'Gras', onclick: () => wrap('**', '**', 'texte') }, 'G'),
      h('button', { type: 'button', title: 'Italique', onclick: () => wrap('*', '*', 'texte') }, 'I'),
      h('button', { type: 'button', onclick: () => prefix('## ') }, 'Titre'),
      h('button', { type: 'button', onclick: () => prefix('### ') }, 'Sous-titre'),
      h('button', { type: 'button', onclick: () => prefix('- ') }, 'Liste'),
      h('button', { type: 'button', onclick: () => prefix('> ') }, 'Citation'),
      h('button', { type: 'button', onclick: () => {
        const url = prompt('Adresse du lien :', 'https://');
        if (url) wrap('[', '](' + url + ')', 'texte du lien');
      } }, 'Lien'),
      h('button', { type: 'button', onclick: () => fileInput.click() }, 'Image…'));

    // images
    const imgPanel = h('div', {});
    const drawImages = () => {
      const it = state.item;
      imgPanel.replaceChildren(
        it.images.length ? h('div', { class: 'imgs' }, it.images.map(n =>
          h('figure', {},
            h('img', { src: '/api/media?path=' + encodeURIComponent(it.path) + '&name=' + encodeURIComponent(n), alt: '' }),
            h('figcaption', { title: n }, n),
            h('div', { class: 'acts' },
              h('button', { type: 'button', onclick: () => insertImage(n) }, 'Insérer'),
              inputs.image && h('button', { type: 'button', onclick: () => { inputs.image.value = n; inputs.image.dataset.v = n; markDirty(); } }, 'Couverture'),
              h('button', { type: 'button', onclick: () => removeImage(n) }, '✕'))))) : h('p', { class: 'muted' }, 'Aucune image.'));
      fillCover();
    };
    const insertImage = (name) => {
      const alt = prompt('Description de l\'image (pour l\'accessibilité) :', '');
      if (alt === null) return;
      insertText('\n![' + (alt || state.item.fields.title || '') + '](' + name + ')\n');
    };
    const removeImage = async (name) => {
      if (!confirm('Supprimer l\'image « ' + name + ' » ?')) return;
      try {
        const r = await api('DELETE', '/api/image?path=' + encodeURIComponent(state.item.path) + '&name=' + encodeURIComponent(name));
        state.item.images = r.images;
        if (inputs.image && inputs.image.value === name) { inputs.image.dataset.v = ''; }
        drawImages(); refreshBadge();
      } catch (e) { toast(e.message, true); }
    };
    const upload = async (file, insert) => {
      const fd = new FormData();
      fd.append('path', state.item.path);
      fd.append('file', file, file.name || 'image.png');
      try {
        toast('Envoi de l\'image…');
        const r = await api('POST', '/api/upload', fd);
        state.item.path = r.path;
        state.item.images = r.images;
        drawImages(); refreshBadge(); refreshPreview();
        if (insert) insertImage(r.name);
      } catch (e) { toast(e.message, true); }
    };
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    fileInput.addEventListener('change', async () => {
      for (const f of fileInput.files) await upload(f, true);
      fileInput.value = '';
    });
    const drop = h('div', { class: 'drop', onclick: () => fileInput.click() }, 'Glissez des images ici ou cliquez pour en ajouter');
    for (const target of [drop, body]) {
      target.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
      target.addEventListener('dragleave', () => drop.classList.remove('over'));
      target.addEventListener('drop', async e => {
        e.preventDefault(); drop.classList.remove('over');
        for (const f of e.dataTransfer.files) if (f.type.startsWith('image/')) await upload(f, true);
      });
    }
    body.addEventListener('paste', async e => {
      const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); for (const f of files) await upload(f, true); }
    });

    // barre du haut
    const saveBtn = h('button', { class: 'btn', onclick: save }, 'Enregistrer');
    async function save() {
      const fields = {};
      for (const f of schema) {
        const el = inputs[f.key];
        if (f.type === 'bool') fields[f.key] = el.checked;
        else if (f.type === 'tags') fields[f.key] = el.value.split(',').map(s => s.trim()).filter(Boolean);
        else fields[f.key] = el.value;
      }
      try {
        const saved = await api('PUT', '/api/item', { path: state.item.path, fields, extra: extra.value, body: body.value });
        state.item = saved; state.dirty = false; saveBtn.textContent = 'Enregistrer';
        toast('Enregistré.'); refreshBadge();
      } catch (e) { toast(e.message, true); }
    }
    const canDelete = coll !== 'pages';
    main.replaceChildren(
      h('div', { class: 'bar' },
        h('button', { class: 'btn sec', onclick: () => go(coll) }, '← ' + SCHEMA[coll].label),
        h('div', { class: 'grow' }),
        canDelete && h('button', { class: 'btn danger', onclick: async () => {
          if (!confirm('Supprimer définitivement « ' + state.item.fields.title + ' » ?')) return;
          try { await api('DELETE', '/api/item?path=' + encodeURIComponent(state.item.path)); state.dirty = false; refreshBadge(); go(coll); }
          catch (e) { toast(e.message, true); }
        } }, 'Supprimer'),
        saveBtn),
      h('div', { class: 'cols' },
        h('div', {}, form, h('h3', {}, 'Images'), drop, imgPanel, fileInput),
        h('div', {}, h('h3', { style: 'margin-top:0' }, 'Texte'), tb,
          h('div', { class: 'split' }, body, preview))));
    drawImages();
    refreshPreview();
    window.scrollTo(0, 0);
  }

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      const btn = main.querySelector('.bar .btn:not(.sec):not(.danger)');
      if (btn && document.getElementById('body')) { e.preventDefault(); btn.click(); }
    }
  });
  window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- réglages ----------
  async function viewSettings() {
    const s = await api('GET', '/api/settings');
    const inputs = s.values.map(v => ({ v, el: h('input', { type: 'text', value: v.value }) }));
    let menu = s.menu.map(m => ({ name: m.name, ref: m.ref }));
    const menuBox = h('div', {});
    const dl = h('datalist', { id: 'pages-dl' }, s.pages.map(p => h('option', { value: p })));
    const drawMenu = () => {
      menuBox.replaceChildren(...menu.map((m, i) => {
        const name = h('input', { type: 'text', value: m.name, placeholder: 'Libellé' });
        const ref = h('input', { type: 'text', value: m.ref, placeholder: '/blog ou https://…', list: 'pages-dl' });
        name.addEventListener('input', () => { m.name = name.value; });
        ref.addEventListener('input', () => { m.ref = ref.value; });
        const move = (d) => { const j = i + d; if (j < 0 || j >= menu.length) return; [menu[i], menu[j]] = [menu[j], menu[i]]; drawMenu(); };
        return h('div', { class: 'menurow' }, name, ref,
          h('div', { class: 'mini' },
            h('button', { type: 'button', onclick: () => move(-1) }, '↑'),
            h('button', { type: 'button', onclick: () => move(1) }, '↓'),
            h('button', { type: 'button', onclick: () => { menu.splice(i, 1); drawMenu(); } }, '✕')));
      }));
    };
    drawMenu();
    const raw = h('textarea', { rows: 18, spellcheck: 'false', style: 'font-family:monospace' });
    const rawDetails = h('details', {}, h('summary', {}, 'Fichier de configuration complet (hugo.toml)'),
      h('p', { class: 'err' }, 'Réservé aux utilisateurs avancés : une erreur peut empêcher la publication du site.'),
      raw, h('button', { class: 'btn sec', onclick: async () => {
        if (!confirm('Écraser hugo.toml avec ce texte ?')) return;
        try { await api('PUT', '/api/raw', { text: raw.value }); toast('hugo.toml enregistré.'); refreshBadge(); } catch (e) { toast(e.message, true); }
      } }, 'Enregistrer le fichier'));
    rawDetails.addEventListener('toggle', async () => {
      if (rawDetails.open && !raw.value) raw.value = (await api('GET', '/api/raw')).text;
    });
    main.replaceChildren(
      h('h2', {}, 'Menu et réglages'),
      h('div', { class: 'card' },
        h('h3', { style: 'margin-top:0' }, 'Informations du site'),
        inputs.map(({ v, el }) => h('label', {}, v.label, el)),
        h('p', { class: 'muted' }, 'Réseaux sociaux : laissez vide pour masquer le lien.')),
      h('div', { class: 'card', style: 'margin-top:1rem' },
        h('h3', { style: 'margin-top:0' }, 'Menu principal'),
        dl, menuBox,
        h('button', { class: 'btn sec', onclick: () => { menu.push({ name: '', ref: '' }); drawMenu(); } }, '+ Ajouter une entrée')),
      h('div', { class: 'bar', style: 'margin-top:1rem' },
        h('button', { class: 'btn', onclick: async () => {
          try {
            await api('PUT', '/api/settings', {
              values: inputs.map(({ v, el }) => ({ section: v.section, key: v.key, value: el.value })),
              menu,
            });
            toast('Réglages enregistrés.'); refreshBadge();
          } catch (e) { toast(e.message, true); }
        } }, 'Enregistrer')),
      rawDetails);
  }

  // ---------- publication (Git) ----------
  async function viewPublish() {
    const st = await api('GET', '/api/git/status');
    if (!st.available) {
      main.replaceChildren(h('h2', {}, 'Publier'),
        h('div', { class: 'card' },
          h('p', { class: 'err' }, 'Git n\'est pas disponible.'),
          h('p', {}, 'Installez Git (https://git-scm.com/downloads), puis relancez l\'éditeur.'),
          h('pre', { class: 'log' }, st.message || '')));
      return;
    }
    const id = await api('GET', '/api/git/identity');
    const log = h('pre', { class: 'log', hidden: true });
    const showLog = (r) => { log.hidden = false; log.textContent = r.log || (r.ok ? 'OK' : 'Erreur'); };
    const msg = h('input', { type: 'text', value: 'Mise à jour du contenu' });
    const name = h('input', { type: 'text', value: id.name });
    const email = h('input', { type: 'email', value: id.email });
    const publishBtn = h('button', { class: 'btn', disabled: !id.configured || st.changes.length + st.ahead === 0, onclick: async () => {
      publishBtn.disabled = true; toast('Publication en cours…');
      try {
        const r = await api('POST', '/api/git/publish', { message: msg.value });
        showLog(r);
        toast(r.ok ? 'Publié ! Le site sera en ligne dans 1 à 2 minutes.' : 'La publication a échoué (voir le détail).', !r.ok);
        if (r.ok) setTimeout(viewPublish, 1500);
      } catch (e) { toast(e.message, true); }
      publishBtn.disabled = false; refreshBadge();
    } }, 'Publier sur le site');
    const idCard = !id.configured && h('div', { class: 'card', style: 'margin-bottom:1rem' },
      h('p', { class: 'err' }, 'Première utilisation : indiquez votre nom et votre e-mail (signature des publications).'),
      h('label', {}, 'Nom', name), h('label', {}, 'Adresse e-mail', email),
      h('button', { class: 'btn', onclick: async () => {
        try { await api('POST', '/api/git/identity', { name: name.value, email: email.value }); toast('Enregistré.'); viewPublish(); }
        catch (e) { toast(e.message, true); }
      } }, 'Enregistrer'));
    main.replaceChildren(
      h('h2', {}, 'Publier'),
      idCard,
      h('div', { class: 'card' },
        h('p', {}, h('strong', {}, st.changes.length + ' fichier(s) modifié(s)'),
          st.ahead ? ' · ' + st.ahead + ' publication(s) en attente d\'envoi' : '',
          st.behind ? ' · ' + st.behind + ' changement(s) à récupérer' : ''),
        st.changes.length ? h('div', { class: 'changes' }, st.changes.map(c =>
          h('div', {}, h('span', { class: 'code' }, c.code), c.file))) : h('p', { class: 'muted' }, 'Aucune modification en attente.'),
        h('label', { style: 'margin-top:1rem' }, 'Description de la publication', msg),
        h('div', { class: 'bar' },
          publishBtn,
          h('button', { class: 'btn sec', onclick: async () => {
            toast('Récupération…');
            try { const r = await api('POST', '/api/git/pull'); showLog(r); toast(r.ok ? 'À jour.' : 'Échec (voir le détail).', !r.ok); refreshBadge(); }
            catch (e) { toast(e.message, true); }
          } }, 'Récupérer les changements en ligne'))),
      log);
  }

  // ---------- aperçu du site ----------
  document.getElementById('btn-preview').addEventListener('click', async () => {
    toast('Construction du site… (la première fois, Hugo est téléchargé : patientez)');
    try {
      const r = await api('POST', '/api/build');
      if (r.ok) { window.open('/site/', '_blank'); toast('Aperçu prêt.'); }
      else { toast('La construction a échoué.', true); main.replaceChildren(h('h2', {}, 'Erreur de construction'), h('pre', { class: 'log' }, r.log)); }
    } catch (e) { toast(e.message, true); }
  });

  // ---------- démarrage ----------
  document.querySelectorAll('#nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
  api('GET', '/api/schema').then(s => { SCHEMA = s; go('blog'); refreshBadge(); });
})();
