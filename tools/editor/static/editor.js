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
    if (view === 'appearance') return viewAppearance();
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

  // ---------- widgets de formulaire ----------
  // Liste de cases à cocher ; options = [[valeur, libellé], ...]
  function checkList(options, selected, onChange, addPlaceholder) {
    const sel = new Set(selected);
    const box = h('div', { class: 'checks' });
    const draw = () => {
      const opts = options.slice();
      sel.forEach(v => { if (!opts.some(o => o[0] === v)) opts.push([v, v]); });
      box.replaceChildren(...opts.map(([val, label]) => {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = sel.has(val);
        cb.addEventListener('change', () => { cb.checked ? sel.add(val) : sel.delete(val); onChange(); });
        return h('label', { class: 'check small' }, cb, label);
      }));
    };
    draw();
    const el = h('div', {}, box);
    if (addPlaceholder) {
      const inp = h('input', { type: 'text', placeholder: addPlaceholder });
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = inp.value.trim();
        if (v) { options.push([v, v]); sel.add(v); inp.value = ''; draw(); onChange(); }
      });
      el.append(inp);
    }
    return { el, get: () => [...sel] };
  }

  const SECTION_TYPES = {
    texte: { label: 'Texte', fields: [
      ['titre', 'Titre', 'text'], ['texte', 'Texte (Markdown)', 'textarea'],
      ['fond', 'Fond', 'select', [['clair', 'Clair'], ['alt', 'Gris léger'], ['accent', 'Couleur d\'accent']]]] },
    image: { label: 'Grande image', fields: [
      ['image', 'Image', 'image'], ['titre', 'Titre (sur l\'image)', 'text'], ['texte', 'Texte (sur l\'image)', 'textarea'],
      ['hauteur', 'Hauteur', 'select', [['plein', 'Plein écran'], ['moyen', 'Moyenne']]],
      ['alt', 'Description de l\'image (accessibilité)', 'text']] },
    video: { label: 'Vidéo YouTube', fields: [
      ['video', 'Adresse YouTube', 'url'], ['titre', 'Titre', 'text'], ['texte', 'Texte', 'textarea'],
      ['mode', 'Affichage', 'select', [['lecteur', 'Lecteur (lu au clic)'], ['fond', 'Vidéo en fond (boucle, sans son)']]]] },
    citation: { label: 'Citation', fields: [
      ['texte', 'Citation', 'textarea'], ['auteur', 'Auteur', 'text'],
      ['fond', 'Fond', 'select', [['accent', 'Couleur d\'accent'], ['clair', 'Clair'], ['alt', 'Gris léger']]]] },
    galerie: { label: 'Galerie d\'images', fields: [['titre', 'Titre', 'text'], ['images', 'Images', 'images']] },
    colonnes: { label: 'Texte + image', fields: [
      ['titre', 'Titre', 'text'], ['texte', 'Texte (Markdown)', 'textarea'], ['image', 'Image', 'image'],
      ['cote', 'Image à', 'select', [['droite', 'droite'], ['gauche', 'gauche']]], ['alt', 'Description de l\'image', 'text']] },
  };

  // Constructeur de sections (blocs) : getImages() renvoie les images de la page,
  // uploadImage(file) renvoie le nom du fichier ajouté.
  function sectionsBuilder(initial, getImages, uploadImage, onChange) {
    const blocks = JSON.parse(JSON.stringify(initial || []));
    const root = h('div', { class: 'builder' });
    const list = h('div', {});
    const typeSel = h('select', {}, Object.entries(SECTION_TYPES).map(([k, v]) => h('option', { value: k }, v.label)));
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= blocks.length) return; [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; draw(); onChange(); };
    function field(b, [key, label, kind, opts]) {
      let el;
      if (kind === 'textarea') { el = h('textarea', { rows: 3 }); el.value = b[key] || ''; el.addEventListener('input', () => { b[key] = el.value; onChange(); }); }
      else if (kind === 'select') {
        el = h('select', {}, opts.map(([v, l]) => h('option', { value: v }, l)));
        el.value = b[key] || opts[0][0];
        if (!b[key]) b[key] = opts[0][0];
        el.addEventListener('change', () => { b[key] = el.value; onChange(); });
      } else if (kind === 'image') {
        const sel = h('select', {}, [h('option', { value: '' }, '(aucune)'), ...getImages().map(n => h('option', { value: n }, n))]);
        if (b[key] && !getImages().includes(b[key])) sel.append(h('option', { value: b[key] }, b[key]));
        sel.value = b[key] || '';
        sel.addEventListener('change', () => { b[key] = sel.value; onChange(); });
        const up = h('input', { type: 'file', accept: 'image/*', hidden: true });
        up.addEventListener('change', async () => {
          if (!up.files[0]) return;
          const name = await uploadImage(up.files[0]);
          if (name) { b[key] = name; draw(); onChange(); }
        });
        el = h('div', { class: 'imgpick' }, sel, h('button', { type: 'button', class: 'btn sec', onclick: () => up.click() }, 'Ajouter…'), up);
      } else if (kind === 'images') {
        const cl = checkList(getImages().map(n => [n, n]), b[key] || [], () => { b[key] = cl.get(); onChange(); });
        el = cl.el;
      } else {
        el = h('input', { type: kind === 'url' ? 'url' : 'text' });
        el.value = b[key] || '';
        el.addEventListener('input', () => { b[key] = el.value; onChange(); });
      }
      return h('label', {}, label, el);
    }
    function draw() {
      list.replaceChildren(...blocks.map((b, i) => {
        const def = SECTION_TYPES[b.type];
        return h('div', { class: 'block' },
          h('div', { class: 'block-head' },
            h('strong', {}, (i + 1) + '. ' + def.label),
            h('span', { class: 'grow' }),
            h('button', { type: 'button', onclick: () => move(i, -1) }, '↑'),
            h('button', { type: 'button', onclick: () => move(i, 1) }, '↓'),
            h('button', { type: 'button', onclick: () => { if (confirm('Supprimer cette section ?')) { blocks.splice(i, 1); draw(); onChange(); } } }, '✕')),
          def.fields.map(f => field(b, f)));
      }));
      if (!blocks.length) list.append(h('p', { class: 'muted' }, 'Aucune section pour l\'instant.'));
    }
    draw();
    root.append(list, h('div', { class: 'bar' }, typeSel,
      h('button', { type: 'button', class: 'btn sec', onclick: () => { blocks.push({ type: typeSel.value }); draw(); onChange(); } }, '+ Ajouter une section')));
    return { el: root, get: () => blocks, refresh: draw };
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
    const getters = {};
    const markDirty = () => { state.dirty = true; saveBtn.textContent = 'Enregistrer •'; };
    const themesList = await api('GET', '/api/themes');
    const linkable = (await Promise.all(['blog', 'book'].map(c => api('GET', '/api/items/' + c))))
      .flat().filter(i => i.path !== item.path).map(i => [i.path, i.title]);
    let builder = null;

    const form = h('div', { class: 'card' });
    for (const f of schema) {
      const v = item.fields[f.key];
      let el;
      if (f.type === 'themes') {
        const w = checkList(themesList.map(t => [t, t]), v || [], markDirty, 'Nouveau thème + Entrée');
        getters[f.key] = w.get;
        form.append(h('label', {}, f.label), w.el, h('div', { style: 'height:.9rem' }));
        continue;
      }
      if (f.type === 'pages') {
        const w = checkList(linkable, v || [], markDirty);
        getters[f.key] = w.get;
        form.append(h('label', {}, f.label), h('div', { class: 'scroll' }, w.el), h('div', { style: 'height:.9rem' }));
        continue;
      }
      if (f.type === 'sections') continue; // construit plus bas
      if (f.type === 'select') {
        el = h('select', {}, f.options.map(([val, lab]) => h('option', { value: val }, lab)));
        el.value = v || f.default || f.options[0][0];
        el.addEventListener('change', () => { markDirty(); if (f.key === 'mise_en_page') toggleBuilder(); });
        inputs[f.key] = el;
        form.append(h('label', {}, f.label, el));
        continue;
      }
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
      h('button', { type: 'button', onclick: () => fileInput.click() }, 'Image…'),
      h('button', { type: 'button', onclick: () => {
        const url = prompt('Adresse de la vidéo YouTube :', 'https://www.youtube.com/watch?v=');
        if (url && /youtu/.test(url)) insertText('\n{{< video url="' + url.trim() + '" >}}\n');
        else if (url) toast('Adresse YouTube non reconnue.', true);
      } }, 'Vidéo…'));

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
      if (builder) builder.refresh();
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
        return r.name;
      } catch (e) { toast(e.message, true); return null; }
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
        if (f.type === 'sections') { fields[f.key] = builder ? builder.get() : []; continue; }
        if (getters[f.key]) { fields[f.key] = getters[f.key](); continue; }
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
    const secField = schema.find(f => f.type === 'sections');
    const builderBox = h('div', { class: 'card', style: 'margin-top:1rem' });
    if (secField) {
      builder = sectionsBuilder(item.fields.sections, () => state.item.images, (file) => upload(file, false), markDirty);
      builderBox.append(h('h3', { style: 'margin-top:0' }, 'Sections (défilement progressif)'),
        h('p', { class: 'muted' }, 'Chaque section s\'affiche en grand, l\'une après l\'autre. Le texte libre ci-dessus s\'affiche en dessous.'),
        builder.el);
    }
    function toggleBuilder() {
      builderBox.hidden = !secField || !inputs.mise_en_page || inputs.mise_en_page.value === 'standard';
    }
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
          h('div', { class: 'split' }, body, preview), builderBox)));
    drawImages();
    toggleBuilder();
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

  // ---------- apparence ----------
  function contrastText(hex) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.4 ? '#111111' : '#ffffff';
  }

  async function viewAppearance() {
    const t = await api('GET', '/api/theme');
    const vals = Object.assign({ accent: '#a3262a', bg: '#faf8f4', text: '#1c1b1a', font_titres: 'classique',
      font_texte: 'moderne', radius: 4, bouton: 'plein', mode: 'auto', logo: '', favicon: '', preset: 'magazine' }, t.values);
    const fonts = t.fonts;
    const prev = h('div', { class: 'tp' });
    const dirty = () => { state.dirty = true; };
    const drawPreview = () => {
      const dark = vals.mode === 'sombre';
      const bg = dark ? '#161514' : vals.bg, text = dark ? '#ece8e1' : vals.text;
      const accent = dark ? vals.accent : vals.accent;
      prev.setAttribute('style', '--bg:' + bg + ';--text:' + text + ';--accent:' + accent + ';--accent-text:' + contrastText(accent) +
        ';--serif:' + fonts[vals.font_titres].stack.replace(/"/g, "'") + ';--sans:' + fonts[vals.font_texte].stack.replace(/"/g, "'") +
        ';--radius:' + vals.radius + 'px');
      prev.classList.toggle('outline', vals.bouton === 'contour');
      prev.replaceChildren(
        h('div', { class: 'tp-head' },
          vals.logo ? h('img', { src: '/api/static?path=' + encodeURIComponent(vals.logo), alt: '', style: 'max-height:36px' }) : h('strong', {}, 'Nom du site'),
          h('span', { class: 'tp-nav' }, 'Accueil  Blog  Book')),
        h('h4', {}, 'Un titre de reportage'),
        h('p', {}, 'Un paragraphe de texte courant pour juger la lisibilité, avec un ', h('a', {}, 'lien'), '.'),
        h('p', {}, h('span', { class: 'tp-btn' }, 'Bouton'), ' ', h('span', { class: 'tp-tile' }, 'Vignette')));
    };
    const field = (label, el) => h('label', {}, label, el);
    const colorInput = (key, label) => {
      const el = h('input', { type: 'color', value: vals[key] });
      el.addEventListener('input', () => { vals[key] = el.value; vals.preset = 'personnalise'; presetSel.value = 'personnalise'; dirty(); drawPreview(); });
      return field(label, el);
    };
    const selectInput = (key, label, options) => {
      const el = h('select', {}, options.map(([v, l]) => h('option', { value: v }, l)));
      el.value = vals[key];
      el.addEventListener('change', () => { vals[key] = el.value; vals.preset = 'personnalise'; presetSel.value = 'personnalise'; dirty(); drawPreview(); });
      return field(label, el);
    };
    const presetSel = h('select', {}, [...Object.entries(t.presets).map(([k, p]) => h('option', { value: k }, p.label)),
      h('option', { value: 'personnalise' }, 'Personnalisé')]);
    presetSel.value = vals.preset in t.presets ? vals.preset : 'personnalise';
    const fontOpts = Object.entries(fonts).map(([k, f]) => [k, f.label]);
    const controls = h('div', { class: 'card' });
    const buildControls = () => controls.replaceChildren(
      colorInput('accent', 'Couleur d\'accent (boutons, liens, barre de progression)'),
      colorInput('bg', 'Couleur de fond'),
      colorInput('text', 'Couleur du texte'),
      selectInput('font_titres', 'Police des titres', fontOpts),
      selectInput('font_texte', 'Police du texte', fontOpts),
      (() => {
        const el = h('input', { type: 'range', min: 0, max: 24, value: vals.radius });
        el.addEventListener('input', () => { vals.radius = +el.value; dirty(); drawPreview(); });
        return field('Arrondi des coins', el);
      })(),
      selectInput('bouton', 'Style des boutons', [['plein', 'Pleins'], ['contour', 'Contour']]),
      selectInput('mode', 'Mode clair / sombre', [['auto', 'Automatique (selon l\'appareil)'], ['clair', 'Toujours clair'], ['sombre', 'Toujours sombre']]));
    presetSel.addEventListener('change', () => {
      const p = t.presets[presetSel.value];
      if (p) { Object.assign(vals, p, { preset: presetSel.value }); dirty(); buildControls(); drawPreview(); }
    });
    buildControls();

    const brand = (kind, label, hint) => {
      const info = h('span', { class: 'muted small' }, vals[kind] || 'aucun');
      const file = h('input', { type: 'file', hidden: true, accept: kind === 'logo' ? '.png,.svg,.jpg,.jpeg,.webp' : '.png,.svg,.ico' });
      file.addEventListener('change', async () => {
        if (!file.files[0]) return;
        const fd = new FormData(); fd.append('kind', kind); fd.append('file', file.files[0]);
        try { const r = await api('POST', '/api/brand', fd); vals[kind] = r.path; info.textContent = r.path; dirty(); drawPreview(); toast('Fichier envoyé. Pensez à enregistrer.'); }
        catch (e) { toast(e.message, true); }
      });
      return h('div', { style: 'margin-bottom:1rem' }, h('strong', {}, label), h('p', { class: 'muted small', style: 'margin:.1rem 0 .4rem' }, hint),
        h('div', { class: 'bar', style: 'margin:0' }, h('button', { class: 'btn sec', onclick: () => file.click() }, 'Choisir un fichier…'),
          h('button', { class: 'btn sec', onclick: () => { vals[kind] = ''; info.textContent = 'aucun'; dirty(); drawPreview(); } }, 'Retirer'), info, file));
    };

    main.replaceChildren(
      h('h2', {}, 'Apparence'),
      h('div', { class: 'cols' },
        h('div', {},
          h('div', { class: 'card' }, field('Modèle de départ', presetSel),
            h('p', { class: 'muted small' }, 'Choisir un modèle remplit les réglages ci-dessous, que vous pouvez ensuite ajuster.')),
          h('div', { style: 'height:1rem' }), controls),
        h('div', {},
          h('h3', { style: 'margin-top:0' }, 'Aperçu'), prev,
          h('p', { class: 'muted small' }, 'Pour voir l\'effet sur le vrai site, enregistrez puis cliquez sur « Aperçu du site complet ».'),
          h('div', { class: 'card', style: 'margin-top:1rem' },
            brand('logo', 'Logo', 'Remplace le nom dans l\'en-tête (PNG transparent ou SVG conseillé).'),
            brand('favicon', 'Icône du site', 'Petite icône de l\'onglet du navigateur (PNG carré, SVG ou ICO).')),
          h('div', { class: 'bar', style: 'margin-top:1rem' }, h('button', { class: 'btn', onclick: async () => {
            try {
              await api('PUT', '/api/theme', { values: Object.assign({}, vals, { accent_text: contrastText(vals.accent) }) });
              state.dirty = false; toast('Apparence enregistrée.'); refreshBadge();
            } catch (e) { toast(e.message, true); }
          } }, 'Enregistrer l\'apparence')))));
    drawPreview();
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
