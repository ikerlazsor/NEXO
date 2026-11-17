(function () {
  document.documentElement.classList.add('js');

  var nav = document.getElementById('nav');
  var burger = document.getElementById('burger');
  var sheet = document.getElementById('sheet');
  var dock = document.getElementById('dock');
  var final = document.getElementById('descargar');

  function onScroll() {
    var y = window.scrollY;
    if (nav) nav.classList.toggle('scrolled', y > 8);
    if (dock && final) {
      var r = final.getBoundingClientRect();
      dock.classList.toggle('show', y > 520 && r.top > window.innerHeight * 0.9);
    }
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  function closeSheet() {
    if (!sheet || !burger) return;
    sheet.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Abrir menú');
  }
  if (burger && sheet) {
    burger.addEventListener('click', function () {
      var open = !sheet.classList.contains('open');
      sheet.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    });
    sheet.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', closeSheet); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  }

  // En el móvil, cada botón lleva directo a su tienda; "Descargar" en el iPhone abre la App Store.
  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  var storeUrl = isIOS ? 'https://apps.apple.com/es/app/id6804630497' : isAndroid ? 'https://play.google.com/store/apps/details?id=com.ikerlazsor.nexo' : null;
  if (storeUrl) {
    document.querySelectorAll('a[href="#descargar"]').forEach(function (a) {
      if (a.closest('.org')) return;
      a.setAttribute('href', storeUrl);
      a.setAttribute('rel', 'noopener');
    });
  }

  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('on');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('on'); });
  }

  // Solo una pregunta abierta a la vez.
  document.querySelectorAll('.qs details').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (!d.open) return;
      document.querySelectorAll('.qs details[open]').forEach(function (o) { if (o !== d) o.open = false; });
    });
  });
})();
