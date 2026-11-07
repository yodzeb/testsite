(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Menu mobile
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Filtres du book : un groupe par critère (thème, format), combinés
  var groups = document.querySelectorAll('.filters[data-group]');
  var tiles = document.querySelectorAll('#book-grid .tile');
  if (groups.length) {
    var active = {};
    var apply = function () {
      tiles.forEach(function (t) {
        var themes = (t.getAttribute('data-themes') || '').split('|');
        var fmt = t.getAttribute('data-format');
        var ok = (!active.theme || themes.indexOf(active.theme) !== -1) &&
                 (!active.format || fmt === active.format);
        t.hidden = !ok;
      });
    };
    groups.forEach(function (g) {
      var name = g.getAttribute('data-group');
      g.querySelectorAll('.chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          active[name] = chip.getAttribute('data-filter');
          g.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
          apply();
        });
      });
    });
  }

  // Vidéo YouTube : chargée seulement au clic
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.video-play') : null;
    if (!btn) return;
    var box = btn.closest('.video');
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + box.getAttribute('data-yt') + '?autoplay=1&rel=0';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    f.title = 'Vidéo YouTube';
    box.replaceChildren(f);
  });

  // Vidéo en fond de section : chargée quand la section approche, jamais si « réduire les animations »
  var bgs = document.querySelectorAll('.video-bg[data-yt]');
  if (bgs.length && !reduce && 'IntersectionObserver' in window) {
    var vo = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target, id = el.getAttribute('data-yt');
        vo.unobserve(el);
        if (!id) return;
        var f = document.createElement('iframe');
        f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&mute=1&controls=0&loop=1&playlist=' + id + '&modestbranding=1&playsinline=1&rel=0';
        f.allow = 'autoplay; encrypted-media';
        f.tabIndex = -1;
        f.setAttribute('aria-hidden', 'true');
        el.appendChild(f);
      });
    }, { rootMargin: '200px' });
    bgs.forEach(function (b) { vo.observe(b); });
  }

  // Apparition progressive, barre de progression et points de navigation
  var reveals = document.querySelectorAll('.reveal');
  if (reveals.length) {
    if ('IntersectionObserver' in window) {
      var ro = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); ro.unobserve(en.target); } });
      }, { threshold: 0.12 });
      reveals.forEach(function (r) { ro.observe(r); });
    } else {
      reveals.forEach(function (r) { r.classList.add('in'); });
    }
  }
  var bar = document.querySelector('.progress span');
  if (bar) {
    var tick = false;
    var update = function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? Math.min(100, (window.scrollY / h) * 100) : 0) + '%';
      tick = false;
    };
    window.addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }
  var dots = document.querySelectorAll('.dots a');
  if (dots.length && 'IntersectionObserver' in window) {
    var map = {};
    dots.forEach(function (d) { map[d.getAttribute('href').slice(1)] = d; });
    var so = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          dots.forEach(function (d) { d.classList.remove('on'); });
          var d = map[en.target.id];
          if (d) d.classList.add('on');
        }
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) so.observe(s); });
  }

  // Visionneuse d'images
  var links = document.querySelectorAll('a[data-lightbox]');
  if (links.length && typeof HTMLDialogElement !== 'undefined') {
    var dlg = document.createElement('dialog');
    dlg.className = 'lightbox';
    dlg.innerHTML = '<button class="lightbox-close" aria-label="Fermer">×</button><img alt="">';
    document.body.appendChild(dlg);
    var img = dlg.querySelector('img');
    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        img.src = a.href;
        img.alt = a.querySelector('img').alt || '';
        dlg.showModal();
      });
    });
    dlg.addEventListener('click', function () { dlg.close(); });
  }
})();
