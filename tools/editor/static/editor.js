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
    if (view === 'help') return viewHelp();
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

  // Outils Markdown partagés (texte de l'article et blocs de sections) : boutons + raccourcis
  function mdTools(ta, notify) {
    const MOD = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
    const ALT = /Mac/.test(navigator.platform) ? '⌥' : 'Alt';
    const done = () => { ta.focus(); notify(); };
    const wrap = (a, b, ph) => {
      const s = ta.selectionStart, e = ta.selectionEnd;
      const sel = ta.value.slice(s, e) || ph;
      ta.setRangeText(a + sel + b, s, e, 'end');
      ta.setSelectionRange(s + a.length, s + a.length + sel.length);
      done();
    };
    // applique/retire un préfixe sur toutes les lignes sélectionnées
    const toggleLines = (re, make) => {
      const s = ta.selectionStart, e = ta.selectionEnd;
      const start = ta.value.lastIndexOf('\n', s - 1) + 1;
      let end = ta.value.indexOf('\n', e);
      if (end < 0) end = ta.value.length;
      const ls = ta.value.slice(start, end).split('\n');
      const all = ls.every(l => !l.trim() || re.test(l));
      const out = ls.map((l, i) => (all ? l.replace(re, '') : make(l.replace(re, ''), i))).join('\n');
      ta.setRangeText(out, start, end, 'select');
      done();
    };
    const interTitre = () => toggleLines(/^#{1,6}\s*/, l => '## ' + (l || 'Intertitre'));
    const citation = () => toggleLines(/^>\s?/, l => '> ' + l);
    const liste = () => toggleLines(/^[-*]\s+/, l => '- ' + l);
    const numerotee = () => toggleLines(/^\d+\.\s+/, (l, i) => (i + 1) + '. ' + l);
    const lien = () => {
      const url = prompt('Adresse du lien :', 'https://');
      if (url) wrap('[', '](' + url + ')', 'texte du lien');
    };
    const defs = [
      ['G', 'Gras', MOD + '+B', () => wrap('**', '**', 'texte')],
      ['I', 'Italique', MOD + '+I', () => wrap('*', '*', 'texte')],
      ['Intertitre', 'Intertitre', MOD + '+' + ALT + '+H', interTitre],
      ['Citation', 'Citation', MOD + '+' + ALT + '+Q', citation],
      ['Liste', 'Liste à puces', MOD + '+' + ALT + '+L', liste],
      ['1. Liste', 'Liste numérotée', MOD + '+' + ALT + '+N', numerotee],
      ['Lien', 'Lien', MOD + '+K', lien],
    ];
    const buttons = defs.map(([label, name, key, fn]) =>
      h('button', { type: 'button', title: name + ' (' + key + ')', onclick: fn }, label));
    ta.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const alt = { KeyH: interTitre, KeyQ: citation, KeyL: liste, KeyN: numerotee };
      const plain = { KeyB: () => wrap('**', '**', 'texte'), KeyI: () => wrap('*', '*', 'texte'), KeyK: lien };
      const fn = (e.altKey ? alt : plain)[e.code];
      if (fn) { e.preventDefault(); fn(); }
    });
    return { buttons };
  }

  // Contenus liés : recherche par titre, thème ou texte (la liste devient vite longue)
  function linkSearch(selected, titles, exclude, onChange) {
    const sel = new Set(selected);
    const chips = h('div', { class: 'chips' });
    const results = h('div', { class: 'results' });
    const inp = h('input', { type: 'search', placeholder: 'Rechercher un article ou une réalisation…' });
    const drawChips = () => chips.replaceChildren(...[...sel].map(p =>
      h('span', { class: 'chip2' }, titles[p] || p,
        h('button', { type: 'button', title: 'Retirer', onclick: () => { sel.delete(p); drawChips(); onChange(); } }, '✕'))));
    let timer;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = inp.value.trim();
        if (q.length < 2) { results.replaceChildren(); return; }
        try {
          const r = (await api('GET', '/api/search?q=' + encodeURIComponent(q) + '&exclude=' + encodeURIComponent(exclude())))
            .filter(x => !sel.has(x.path));
          results.replaceChildren(...(r.length ? r.map(x => h('button', { type: 'button', class: 'res', onclick: () => {
            sel.add(x.path); titles[x.path] = x.title; inp.value = ''; results.replaceChildren(); drawChips(); onChange();
          } }, h('strong', {}, x.title),
            h('span', { class: 'muted small' }, (x.collection === 'book' ? 'Réalisation' : 'Article') + (x.date ? ' · ' + x.date : '')),
            x.snippet && h('em', { class: 'muted small' }, x.snippet))) : [h('p', { class: 'muted small' }, 'Aucun résultat.')]));
        } catch (e) { /* ignoré */ }
      }, 250);
    });
    drawChips();
    return { el: h('div', {}, chips, inp, results), get: () => [...sel] };
  }

  const SECTION_TYPES = {
    texte: { label: 'Texte', fields: [
      ['titre', 'Titre', 'text'], ['texte', 'Texte (Markdown)', 'markdown'],
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
      ['titre', 'Titre', 'text'], ['texte', 'Texte (Markdown)', 'markdown'], ['image', 'Image', 'image'],
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
      if (kind === 'markdown') {
        const ta = h('textarea', { rows: 6 });
        ta.value = b[key] || '';
        ta.addEventListener('input', () => { b[key] = ta.value; onChange(); });
        const md = mdTools(ta, () => { b[key] = ta.value; onChange(); });
        el = h('div', {}, h('div', { class: 'toolbar' }, md.buttons), ta);
      } else if (kind === 'textarea') { el = h('textarea', { rows: 3 }); el.value = b[key] || ''; el.addEventListener('input', () => { b[key] = el.value; onChange(); }); }
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
    const HEAD = ['surtitre', 'title', 'chapo'];
    const headCard = h('div', { class: 'card headline' });
    for (const f of schema) {
      const v = item.fields[f.key];
      const target = HEAD.includes(f.key) ? headCard : form;
      let el;
      if (f.type === 'themes') {
        const w = checkList(themesList.map(t => [t, t]), v || [], markDirty, 'Nouveau thème + Entrée');
        getters[f.key] = w.get;
        target.append(h('label', {}, f.label), w.el, h('div', { style: 'height:.9rem' }));
        continue;
      }
      if (f.type === 'pages') {
        const w = linkSearch(v || [], Object.fromEntries(linkable), () => state.item.path, markDirty);
        getters[f.key] = w.get;
        target.append(h('label', {}, f.label), w.el, h('div', { style: 'height:.9rem' }));
        continue;
      }
      if (f.type === 'sections') continue; // construit plus bas
      if (f.type === 'select') {
        el = h('select', {}, f.options.map(([val, lab]) => h('option', { value: val }, lab)));
        el.value = v || f.default || f.options[0][0];
        el.addEventListener('change', () => { markDirty(); if (f.key === 'mise_en_page') toggleBuilder(); });
        inputs[f.key] = el;
        target.append(h('label', {}, f.label, el));
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
      target.append(f.type === 'bool'
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
    const MOD = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
    const ALT = /Mac/.test(navigator.platform) ? '⌥' : 'Alt';
    const md = mdTools(body, () => { markDirty(); refreshPreview(); });
    const btn = (label, title, fn) => h('button', { type: 'button', title, onclick: fn }, label);
    const tb = h('div', { class: 'toolbar' }, md.buttons,
      btn('Photo + légende', 'Photo avec légende et crédit (' + MOD + '+' + ALT + '+P)', () => photoDialog()),
      btn('Vidéo…', 'Vidéo YouTube', () => {
        const url = prompt('Adresse de la vidéo YouTube :', 'https://www.youtube.com/watch?v=');
        if (url && /youtu/.test(url)) insertText('\n{{< video url="' + url.trim() + '" >}}\n');
        else if (url) toast('Adresse YouTube non reconnue.', true);
      }));
    body.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyP') { e.preventDefault(); photoDialog(); }
    });

    // Dialogue « Photo + légende » : écrit ![description](fichier "Légende | © Crédit")
    const photoDialog = (preselect) => new Promise(resolve => {
      const dlg = h('dialog', { class: 'photo-dlg' });
      const sel = h('select', {}, state.item.images.map(n => h('option', { value: n }, n)));
      if (preselect) sel.value = preselect;
      const thumbEl = h('img', { class: 'thumb', alt: '' });
      const thumb = () => { thumbEl.src = sel.value ? '/api/media?path=' + encodeURIComponent(state.item.path) + '&name=' + encodeURIComponent(sel.value) : ''; };
      sel.addEventListener('change', thumb); thumb();
      const up = h('input', { type: 'file', accept: 'image/*', hidden: true });
      up.addEventListener('change', async () => {
        if (!up.files[0]) return;
        const n = await upload(up.files[0], false);
        if (n) { sel.replaceChildren(...state.item.images.map(x => h('option', { value: x }, x))); sel.value = n; thumb(); }
      });
      const legende = h('input', { type: 'text', placeholder: 'Légende affichée sous la photo' });
      const credit = h('input', { type: 'text', value: '© ' });
      const alt = h('input', { type: 'text', placeholder: 'Ce que montre la photo (lecteurs malvoyants)' });
      const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
      const clean = s => s.replace(/"/g, '”').replace(/\s+/g, ' ').trim();
      const ok = h('button', { type: 'button', class: 'btn', onclick: () => {
        if (!sel.value) { toast('Choisissez ou ajoutez une photo.', true); return; }
        const l = clean(legende.value);
        let c = clean(credit.value);
        if (c === '©') c = '';
        const title = [l, c].filter(Boolean).join(' | ');
        const desc = clean(alt.value || legende.value || state.item.fields.title || '');
        insertText('\n![' + desc + '](' + sel.value + (title ? ' "' + title + '"' : '') + ')\n');
        close(true);
      } }, 'Insérer la photo');
      dlg.append(h('h3', { style: 'margin-top:0' }, 'Photo avec légende'),
        h('div', { class: 'imgpick' }, sel, h('button', { type: 'button', class: 'btn sec', onclick: () => up.click() }, 'Ajouter une photo…'), up),
        thumbEl,
        h('label', {}, 'Légende', legende), h('label', {}, 'Crédit photo', credit),
        h('label', {}, 'Description pour l\'accessibilité (facultatif)', alt),
        h('div', { class: 'bar' }, ok, h('button', { type: 'button', class: 'btn sec', onclick: () => close(false) }, 'Annuler')));
      document.body.append(dlg); dlg.showModal(); legende.focus();
    });

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
              h('button', { type: 'button', onclick: () => insertImage(n) }, 'Légende…'),
              inputs.image && h('button', { type: 'button', onclick: () => { inputs.image.value = n; inputs.image.dataset.v = n; markDirty(); } }, 'Couverture'),
              h('button', { type: 'button', onclick: () => removeImage(n) }, '✕'))))) : h('p', { class: 'muted' }, 'Aucune image.'));
      fillCover();
      if (builder) builder.refresh();
    };
    const insertImage = (name) => photoDialog(name);
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
    HEAD.forEach(k => { if (inputs[k]) inputs[k].classList.add('hl-' + k); });
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
        h('div', {}, headCard, h('h3', {}, 'Texte'), tb,
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

  // ---------- aide ----------
  function viewHelp() {
    const mod = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
    const alt = /Mac/.test(navigator.platform) ? '⌥' : 'Alt';
    const sec = (title, ...kids) => h('div', { class: 'card help' }, h('h3', { style: 'margin-top:0' }, title), ...kids);
    const row = (a, b) => h('tr', {}, h('td', {}, h('strong', {}, a)), h('td', {}, b));
    const kbd = (s) => h('kbd', {}, s);
    main.replaceChildren(
      h('h2', {}, 'Aide'),
      sec('Démarrer',
        h('ol', {},
          h('li', {}, 'Choisissez « Articles » ou « Réalisations », puis « + Nouvel·le » : le contenu est créé en brouillon.'),
          h('li', {}, 'Remplissez le sur-titre, le titre et le chapo, puis écrivez le texte.'),
          h('li', {}, 'Cliquez sur « Enregistrer » (', kbd(mod + '+S'), ').'),
          h('li', {}, 'Décochez « Brouillon » quand l\'article est prêt.'),
          h('li', {}, '« Aperçu du site complet » montre le vrai site, puis « Publier » le met en ligne (1 à 2 minutes).'))),
      sec('Les éléments d\'un article',
        h('table', { class: 'helptable' },
          row('Sur-titre', 'Petit texte au-dessus du titre (rubrique, lieu, accroche courte).'),
          row('Titre', 'Titre principal de l\'article.'),
          row('Chapo', 'Introduction affichée en gros sous le titre ; elle sert aussi de résumé dans les listes et les moteurs de recherche.'),
          row('Intertitre', 'Titre de section dans le texte. Bouton « Intertitre » ou ' + mod + '+' + alt + '+H (sur la ligne en cours).'),
          row('Photo + légende', 'Bouton « Photo + légende » ou ' + mod + '+' + alt + '+P : choisissez ou ajoutez une photo, saisissez la légende et le crédit photo. Le crédit apparaît en petit à côté de la légende.'))),
      sec('Raccourcis clavier (dans le texte)',
        h('table', { class: 'helptable' },
          row(mod + '+B', 'Gras'), row(mod + '+I', 'Italique'), row(mod + '+K', 'Lien'),
          row(mod + '+' + alt + '+H', 'Intertitre'), row(mod + '+' + alt + '+Q', 'Citation'),
          row(mod + '+' + alt + '+L', 'Liste à puces'), row(mod + '+' + alt + '+N', 'Liste numérotée'),
          row(mod + '+' + alt + '+P', 'Photo + légende (texte de l\'article)'),
          row(mod + '+S', 'Enregistrer')),
        h('p', { class: 'muted small' }, 'Ces raccourcis fonctionnent aussi dans les textes des sections (types « Texte » et « Texte + image »). Sur une sélection de plusieurs lignes, citation et listes s\'appliquent à toutes les lignes ; un second appui les retire.')),
      sec('Images et vidéos',
        h('ul', {},
          h('li', {}, 'Glissez une image dans la zone « Images » ou dans le texte, ou collez-la : l\'éditeur la réduit et la range avec l\'article, puis propose de saisir la légende.'),
          h('li', {}, 'Image de couverture : bouton « Couverture » sous la miniature.'),
          h('li', {}, 'Vidéo YouTube : champ « Vidéo YouTube » (en haut de l\'article) ou bouton « Vidéo… » (dans le texte). Elle ne se charge qu\'au clic du lecteur.'))),
      sec('Thèmes, format et « Voir aussi »',
        h('ul', {},
          h('li', {}, 'Cochez les thèmes (ou ajoutez-en un avec Entrée) : ils servent aux filtres du book et aux pages de thèmes.'),
          h('li', {}, 'Format : texte, vidéo ou podcast (étiquette sur les vignettes).'),
          h('li', {}, 'Contenus liés : tapez quelques lettres du titre ou du texte d\'un autre contenu, cliquez sur le résultat. Des contenus de mêmes thèmes sont aussi proposés automatiquement.'))),
      sec('Mises en page par sections',
        h('p', {}, 'Dans « Mise en page », choisissez « Sections » (ou « Étude de cas » pour une réalisation). Un constructeur apparaît sous le texte : ajoutez des sections (texte, grande image, vidéo, citation, galerie, texte + image) et réordonnez-les avec ↑ ↓. Le texte libre s\'affiche sous les sections.')),
      sec('Apparence, menu et réglages',
        h('p', {}, '« Apparence » : modèle de départ, couleurs, polices, logo. « Menu et réglages » : nom du site, e-mail, réseaux sociaux, ordre du menu.')),
      sec('Publier',
        h('p', {}, '« Publier » liste les fichiers modifiés. Saisissez une courte description puis cliquez sur « Publier sur le site ». « Récupérer les changements en ligne » met à jour votre copie si le site a été modifié ailleurs.'),
        h('p', { class: 'muted small' }, 'En cas de doute : rien n\'est perdu, chaque publication est conservée et peut être annulée.')));
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
  document.getElementById('btn-help').addEventListener('click', () => go('help'));
  api('GET', '/api/schema').then(s => { SCHEMA = s; go('blog'); refreshBadge(); });
})();
