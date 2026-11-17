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

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Titular: la última palabra va cambiando.
  var rot = document.getElementById('rot');
  if (rot && !reduceMotion) {
    var words = ['conocer gente.', 'hacer amigos.', 'salir más.', 'no aburrirte.'];
    var w = 0;
    setInterval(function () {
      if (document.hidden) return;
      rot.classList.add('out');
      setTimeout(function () {
        w = (w + 1) % words.length;
        rot.textContent = words[w];
        rot.classList.remove('out');
      }, 350);
    }, 2600);
  }

  // ── Esta semana en Madrid: planes reales de Nexo ──
  var SUPABASE = 'https://nixeproyzxvqzyrvsxcx.supabase.co';
  var KEY = 'sb_publishable_1R13untRXme2bbdedl1esQ_P0MsxoXr';
  var CAT = {
    VIBES: { label: 'Social', color: '#E0457B', cover: 'FIESTA_2' },
    DESCUBRIR: { label: 'Descubrir', color: '#0EA5E9', cover: 'MUSEO_1' },
    AIRE_LIBRE: { label: 'Aire libre', color: '#16A34A', cover: 'SENDERISMO_1' },
    FOODIES: { label: 'Comer', color: '#F97316', cover: 'CENAR_2' },
    DEPORTES: { label: 'Deporte', color: '#2563EB', cover: 'RUNNING_1' },
    SHOWTIME: { label: 'Cultura', color: '#8B5CF6', cover: 'TEATRO_1' },
  };
  // Portada según lo que dice el título (como en la app), si no, la de la categoría.
  var TOPICS = [
    [/idioma|language|intercambio|tandem/, 'IDIOMAS_2', 'Idiomas'],
    [/juegos de mesa|board game|ajedrez|chess|rol\b|dungeons/, 'JUEGOS_DE_MESA_1', 'Juegos'],
    [/senderis|hiking|ruta|mirador|sierra|trekking/, 'SENDERISMO_2', 'Senderismo'],
    [/running|run club|correr|carrera/, 'RUNNING_2', 'Running'],
    [/yoga|pilates|medita/, 'AIRE_LIBRE_OTRO_3', 'Bienestar'],
    [/lectura|libro|book|poes|novela|"/, 'ESTUDIO_4', 'Libros'],
    [/cena|dinner|tapas/, 'CENAR_1', 'Cena'],
    [/tardeo|afterwork|copas|drinks|pub|vino|wine|cata/, 'FIESTA_2', 'Tardeo'],
    [/museo|visita|exposici|colecci/, 'MUSEO_1', 'Cultura'],
    [/cine|pel[ií]cula|film/, 'CINE_1', 'Cine'],
    [/teatro|impro|comedia|comedy/, 'TEATRO_1', 'Escena'],
    [/baile|salsa|bachata|danza|dance/, 'FIESTA_1', 'Baile'],
    [/p[aá]del|tenis|tennis|v[oó]ley|f[uú]tbol/, 'PADEL_1', 'Deporte'],
    [/caf[eé]|brunch|coffee/, 'CAFE_1', 'Café'],
  ];
  var DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var FACES = ['#F97316', '#8B5CF6', '#10B981', '#0EA5E9', '#E11D48'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function madridParts(d) {
    var f = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    var o = {};
    f.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function dayKey(d) { var p = madridParts(d); return p.year + '-' + p.month + '-' + p.day; }
  function whenLabel(d) {
    var p = madridParts(d);
    var today = new Date();
    var tomorrow = new Date(today.getTime() + 864e5);
    var time = p.hour + ':' + p.minute;
    if (dayKey(d) === dayKey(today)) return 'Hoy · ' + time;
    if (dayKey(d) === dayKey(tomorrow)) return 'Mañana · ' + time;
    var wd = DAYS[new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Madrid' })).getDay()];
    return wd.charAt(0).toUpperCase() + wd.slice(1) + ' ' + p.day + ' · ' + time;
  }
  function cardHtml(e, href) {
    var d = new Date(e.starts_at);
    var cat = CAT[e.category] || CAT.VIBES;
    var t = norm(e.title);
    var cover = cat.cover, label = cat.label;
    for (var i = 0; i < TOPICS.length; i++) {
      if (TOPICS[i][0].test(t)) { cover = TOPICS[i][1]; label = TOPICS[i][2]; break; }
    }
    var p = madridParts(d);
    var monthIdx = Number(p.month) - 1;
    var people = Number(e.attendance_hint) || 0;
    var faces = '';
    if (people > 0) {
      for (var f = 0; f < Math.min(3, people); f++) faces += '<i style="background:' + FACES[(f + e.title.length) % FACES.length] + '"></i>';
    }
    return '<a class="ev" href="' + href + '" rel="noopener" style="--c:' + cat.color + '">' +
      '<div class="ev-img" style="background-image:url(\'/covers/' + cover + '.jpg\')">' +
        '<span class="chip">' + esc(label) + '</span>' +
        '<span class="ev-day"><b>' + Number(p.day) + '</b><small>' + MONTHS[monthIdx] + '</small></span>' +
      '</div>' +
      '<div class="ev-body">' +
        '<b>' + esc(e.title) + '</b>' +
        '<span class="ev-when">' + whenLabel(d) + '</span>' +
        '<span class="ev-where">' + esc(e.venue || '') + '</span>' +
        (people > 0 ? '<span class="ev-people"><span class="faces">' + faces + '</span>+' + people + ' interesados</span>' : '') +
      '</div></a>';
  }

  var live = document.getElementById('estasemana');
  var railEl = document.getElementById('liveRail');
  if (live && railEl && window.fetch) {
    live.hidden = false;
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    fetch(SUPABASE + '/rest/v1/rpc/get_external_events_page_filtered', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_after_date: null, p_after_id: null, p_categories: null, p_subcategories: null, p_query: null, p_lat: null, p_lon: null, p_radius: null, p_from: null, p_until: null }),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (rows) {
        clearTimeout(timer);
        var now = Date.now(), limit = now + 8 * 864e5, seen = {};
        var list = (rows || [])
          .filter(function (e) {
            var t = Date.parse(e.starts_at);
            var k = norm(e.title).slice(0, 40);
            if (!e.title || !t || t < now || t > limit || seen[k]) return false;
            seen[k] = true;
            return true;
          })
          .sort(function (a, b) {
            // Primero los que tienen más gente, sin perder el orden por fecha.
            return (Number(b.attendance_hint) || 0) >= 20 && !((Number(a.attendance_hint) || 0) >= 20) ? 1
              : (Number(a.attendance_hint) || 0) >= 20 && !((Number(b.attendance_hint) || 0) >= 20) ? -1
              : Date.parse(a.starts_at) - Date.parse(b.starts_at);
          })
          .slice(0, 10)
          .sort(function (a, b) { return Date.parse(a.starts_at) - Date.parse(b.starts_at); });
        if (list.length < 3) { live.hidden = true; return; }
        var href = storeUrl || '#descargar';
        railEl.innerHTML = list.map(function (e) { return cardHtml(e, href); }).join('') +
          '<a class="live-more" href="' + href + '" rel="noopener"><b>Y muchos más planes en la app</b><span>Descargar Nexo →</span></a>';
      })
      .catch(function () { clearTimeout(timer); live.hidden = true; });

    live.querySelectorAll('.arrow').forEach(function (b) {
      b.addEventListener('click', function () {
        railEl.scrollBy({ left: Number(b.getAttribute('data-dir')) * 600, behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    });
  }

  // Solo una pregunta abierta a la vez.
  document.querySelectorAll('.qs details').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (!d.open) return;
      document.querySelectorAll('.qs details[open]').forEach(function (o) { if (o !== d) o.open = false; });
    });
  });
})();
