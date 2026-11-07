(function () {
  // Menu mobile
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Filtres du book
  var chips = document.querySelectorAll('.chip[data-filter]');
  var tiles = document.querySelectorAll('#book-grid .tile');
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var f = chip.getAttribute('data-filter');
      chips.forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
      tiles.forEach(function (t) { t.hidden = f !== '' && t.getAttribute('data-cat') !== f; });
    });
  });

  // Visionneuse d'images (book)
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
