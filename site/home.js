(function () {
  document.documentElement.classList.add('js');

  // ── Inglés (idioma del móvil distinto del español; ver home-i18n.js) ──
  var EN = window.NEXO_LANG === 'en';
  var T = {
    'Planes': 'Plans', 'Cómo funciona': 'How it works', 'Organizadores': 'Organisers', 'Preguntas': 'FAQ',
    'Descargar gratis': 'Get it free', 'Planes en Madrid': 'Plans in Madrid', 'para': 'to',
    'Tardeos, intercambios de idiomas, rutas por la sierra, clubes de lectura, pádel… Apúntate a un plan, habla con el grupo antes de ir y llega sabiendo a quién vas a ver.': 'Afternoon drinks, language exchanges, hikes in the mountains, book clubs, padel… Join a plan, chat with the group before you go and turn up already knowing who you’ll meet.',
    'Descárgala en': 'Download on the', 'Disponible en': 'Get it on',
    'Planes nuevos': 'New plans', 'cada semana': 'every week', 'Chat de grupo': 'Group chat', 'en cada plan': 'in every plan',
    'Solo +18': '18+ only', 'y perfiles con valoraciones': 'and profiles with reviews',
    'Buscar planes': 'Search plans', 'Filtros': 'Filters', 'Idiomas': 'Languages',
    'Intercambio de idiomas en Malasaña': 'Language exchange in Malasaña', 'Jue 20 · 20:00': 'Thu 20 · 20:00', 'Unirme': 'Join',
    'Senderismo': 'Hiking', 'Ruta a La Pedriza': 'Hike to La Pedriza', 'Sáb 22 · 9:30': 'Sat 22 · 9:30',
    'Feed': 'Feed', 'Mapa': 'Map', 'Chats': 'Chats',
    'Tardeo en una terraza': 'Drinks on a terrace', 'Hoy · 18:30 · 23 apuntados': 'Today · 18:30 · 23 going',
    'Chat del plan': 'Plan chat', '“¡Nos vemos en la puerta!”': '“See you at the door!”',
    'Te has unido': 'You’re in', 'Te avisamos el día del plan': 'We’ll remind you on the day',
    'En directo': 'Live', 'Esta semana en Madrid': 'This week in Madrid',
    'Algunos de los planes que hay ahora mismo en Nexo. Ábrelos en la app para ver quién va y apuntarte.': 'Some of the plans on Nexo right now. Open them in the app to see who’s going and join.',
    'Qué hay en Nexo': 'What’s on Nexo', 'Algo para cada día de la semana': 'Something for every day of the week',
    'Planes de la gente de Nexo y quedadas de grupos y organizadores de Madrid, todos en el mismo feed y en el mapa.': 'Plans made by Nexo users and meetups from Madrid groups and organisers, all in one feed and on the map.',
    'Tardeos': 'Afternoon drinks', 'Terrazas y afterworks': 'Terraces and afterworks',
    'Intercambios de idiomas': 'Language exchanges', 'Inglés, francés, italiano…': 'English, French, Italian…',
    'Rutas por la sierra': 'Trails in the mountains', 'Clubes de lectura': 'Book clubs', 'Un libro, una charla': 'One book, one chat',
    'Running': 'Running', 'Por el Retiro y Madrid Río': 'Around Retiro and Madrid Río', 'Juegos de mesa': 'Board games',
    'Partidas en cafés': 'Games in cafés', 'Cenas': 'Dinners', 'Con gente nueva': 'With new people',
    'Pádel y deporte': 'Padel and sports', 'Pachangas y partidos': 'Pick-up games and matches', 'Cultura': 'Culture',
    'Museos y exposiciones': 'Museums and exhibitions',
    'De “no tengo plan” a quedar, en tres pasos': 'From “no plans” to meeting up, in three steps',
    'Encuentra tu plan': 'Find your plan',
    'Mira el feed o el mapa, filtra por lo que te apetece y por cuándo, y mira quién va antes de apuntarte.': 'Browse the feed or the map, filter by what you fancy and when, and see who’s going before you join.',
    'Únete y habla con el grupo': 'Join and chat with the group',
    'Con un toque estás dentro del chat del plan: saludas, preguntas dudas y quedáis en el sitio exacto.': 'One tap and you’re in the plan’s chat: say hi, ask questions and agree on the exact spot.',
    'Queda y conoce gente': 'Meet up and make friends',
    'Te recordamos el plan ese día. Después puedes valorar la experiencia y seguir en contacto con la gente.': 'We remind you on the day. Afterwards you can review it and keep in touch with people.',
    'Feed y mapa': 'Feed and map', 'Todo lo que pasa en Madrid, cerca de ti': 'Everything happening in Madrid, near you',
    'Planes de la comunidad y quedadas de grupos de la ciudad. En el mapa ves qué hay en tu barrio esta semana.': 'Community plans and meetups from groups around the city. The map shows what’s on in your neighbourhood this week.',
    'Chat de grupo en cada plan': 'A group chat for every plan',
    'Habla con los apuntados antes de ir. Así no llegas sin conocer a nadie.': 'Talk to everyone who’s going before you get there, so you never arrive as a total stranger.',
    'Recordatorios': 'Reminders', 'Te avisamos el día del plan para que no se te pase.': 'We’ll nudge you on the day so you don’t forget.',
    'Comunidad cuidada': 'A safe community',
    'Solo mayores de 18, valoraciones después de cada plan y opción de reportar o bloquear.': '18+ only, reviews after every plan and the option to report or block.',
    'Planes solo para chicas': 'Women-only plans', 'Quien organiza puede hacer que su plan lo vean solo mujeres.': 'Organisers can make a plan visible to women only.',
    'Para quién es': 'Who it’s for', 'Para cualquiera que quiera hacer más planes en Madrid': 'For anyone who wants to do more in Madrid',
    'Te acabas de mudar.': 'You’ve just moved here.', 'Conoce gente desde la primera semana.': 'Meet people from your very first week.',
    'Estás de Erasmus o eres expat.': 'You’re on Erasmus or an expat.', 'Practica el idioma y haz amigos locales.': 'Practise Spanish and make local friends.',
    'Tus amigos nunca pueden.': 'Your friends are never free.', 'Encuentra con quién hacer ese plan que te apetece.': 'Find people to do that thing you’ve been wanting to do.',
    'Quieres probar algo nuevo.': 'You want to try something new.', 'Desde una ruta a un club de lectura, sin compromiso.': 'From a hike to a book club, no strings attached.',
    'Para grupos y organizadores': 'For groups and organisers', '¿Organizas quedadas? Publícalas gratis en Nexo': 'Run meetups? Post them on Nexo for free',
    'Intercambios, rutas, tardeos, clubes, deporte… Crea tu cuenta y sube tus planes en dos minutos. Sin aprobaciones ni comisiones.': 'Language exchanges, hikes, drinks, clubs, sports… Create an account and post your plans in two minutes. No approvals, no fees.',
    'Gente nueva que todavía no te conoce': 'New people who haven’t found you yet', 'Tus propias fotos de portada': 'Your own cover photos',
    'Chat de grupo con los apuntados': 'A group chat with everyone going', 'Recordatorios automáticos': 'Automatic reminders',
    'Un enlace con portada para compartir en Instagram o WhatsApp': 'A shareable link with a cover for Instagram or WhatsApp',
    'Publicar mis planes': 'Post my plans', 'Escríbenos': 'Get in touch', 'Language Exchange · cada jueves': 'Language Exchange · every Thursday',
    'apuntados': 'going', 'nuevos': 'new', '“¡Bienvenidos! Estaremos en la mesa del fondo 👋”': '“Welcome! We’ll be at the table at the back 👋”',
    'Preguntas frecuentes': 'FAQ', 'Lo que suele preguntar la gente': 'What people usually ask',
    '¿Nexo es gratis?': 'Is Nexo free?', 'Sí. Crear la cuenta, ver planes, apuntarte, hablar en los chats y publicar tus propios planes es gratis.': 'Yes. Creating an account, browsing and joining plans, chatting and posting your own plans are all free.',
    '¿Tengo que ir con alguien?': 'Do I need to go with someone?', 'No. La mayoría de la gente va sola: para eso está el chat del plan, para saludar antes y llegar sabiendo a quién vas a ver.': 'No. Most people go on their own – that’s what the plan chat is for: say hi beforehand and arrive knowing who you’ll meet.',
    '¿En qué ciudades funciona?': 'Which cities is it in?', 'Ahora mismo en Madrid y alrededores. Pronto llegaremos a más ciudades.': 'Right now Madrid and the surrounding area. More cities soon.',
    '¿Es seguro?': 'Is it safe?', 'Solo pueden usarla mayores de 18. Cada perfil tiene valoraciones de otros planes y puedes reportar o bloquear a quien quieras. Lee nuestras': 'It’s 18+ only. Every profile has reviews from other plans and you can report or block anyone. Read our',
    'normas de la comunidad': 'community guidelines', 'Organizo quedadas, ¿cómo las publico?': 'I run meetups – how do I post them?',
    'Descarga Nexo, crea tu cuenta y publica tus planes con tus propias fotos. Si tienes dudas, escríbenos a': 'Download Nexo, create an account and post your plans with your own photos. Any questions? Email us at',
    '¿Puedo borrar mi cuenta?': 'Can I delete my account?', 'Sí, desde Ajustes en la app o en': 'Yes, from Settings in the app or at',
    '. Tus datos se tratan según nuestra': '. Your data is handled according to our', 'política de privacidad': 'privacy policy',
    'Tu próximo plan': 'Your next plan', 'está en Nexo': 'is on Nexo', 'Descárgala gratis y apúntate a algo esta semana.': 'Download it free and join something this week.',
    'Planes en Madrid para conocer gente. Solo mayores de 18.': 'Plans in Madrid to meet people. 18+ only.',
    'Soporte': 'Support', 'Privacidad': 'Privacy', 'Términos': 'Terms', 'Normas de la comunidad': 'Community guidelines',
    'Eliminar cuenta': 'Delete account', '© 2026 Nexo · Hecho en Madrid': '© 2026 Nexo · Made in Madrid', 'Descargar Nexo gratis': 'Get Nexo free',
    'Nexo, inicio': 'Nexo, home', 'Principal': 'Main', 'Abrir menú': 'Open menu', 'Cerrar menú': 'Close menu', 'Menú': 'Menu',
    'Planes de esta semana': 'Plans this week', 'Tipos de planes': 'Kinds of plans', 'Grupo de amigos riéndose en Madrid': 'Friends laughing together in Madrid',
    'Idioma': 'Language',
  };
  function tr(s) { return EN && T[s] != null ? T[s] : s; }
  if (EN) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node, nodes = [];
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(function (n) {
      var raw = n.nodeValue, key = raw.replace(/\s+/g, ' ').trim();
      if (key && T[key] != null) n.nodeValue = raw.replace(raw.trim(), T[key]);
    });
    document.querySelectorAll('[aria-label],[alt]').forEach(function (el) {
      ['aria-label', 'alt'].forEach(function (a) {
        var v = el.getAttribute(a);
        if (v && T[v] != null) el.setAttribute(a, T[v]);
      });
    });
    document.title = 'Nexo — Plans in Madrid to meet people';
    var md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute('content', 'Nexo is the app to find plans in Madrid and meet people: drinks, language exchanges, hikes, book clubs, sports and more. Free on iPhone and Android.');
    document.querySelectorAll('a[href^="https://apps.apple.com/es/"]').forEach(function (a) {
      a.href = a.href.replace('/es/', '/');
    });
    var mail = document.querySelector('.org-cta a[href^="mailto:"]');
    if (mail) mail.href = 'mailto:hola@appnexo.es?subject=Posting%20plans%20on%20Nexo';
  }
  document.querySelectorAll('.langs a').forEach(function (a) {
    a.classList.toggle('on', a.getAttribute('data-lang') === (EN ? 'en' : 'es'));
  });
  document.documentElement.classList.remove('i18n-pending');

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
    burger.setAttribute('aria-label', tr('Abrir menú'));
  }
  if (burger && sheet) {
    burger.addEventListener('click', function () {
      var open = !sheet.classList.contains('open');
      sheet.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', tr(open ? 'Cerrar menú' : 'Abrir menú'));
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

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Titular: la última palabra va cambiando.
  var rot = document.getElementById('rot');
  if (rot && !reduceMotion) {
    var words = EN
      ? ['meet people.', 'make friends.', 'get out more.', 'never be bored.']
      : ['conocer gente.', 'hacer amigos.', 'salir más.', 'no aburrirte.'];
    if (EN) rot.textContent = words[0];
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
  var DAYS = EN ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var MONTHS = EN
    ? ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    : ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var LABEL_EN = {
    Social: 'Social', Descubrir: 'Discover', 'Aire libre': 'Outdoors', Comer: 'Food', Deporte: 'Sport', Cultura: 'Culture',
    Idiomas: 'Languages', Juegos: 'Games', Senderismo: 'Hiking', Running: 'Running', Bienestar: 'Wellbeing', Libros: 'Books',
    Cena: 'Dinner', Tardeo: 'Drinks', Cine: 'Cinema', Escena: 'Stage', Baile: 'Dance', 'Café': 'Coffee',
  };
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
    if (dayKey(d) === dayKey(today)) return (EN ? 'Today · ' : 'Hoy · ') + time;
    if (dayKey(d) === dayKey(tomorrow)) return (EN ? 'Tomorrow · ' : 'Mañana · ') + time;
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
    if (EN && LABEL_EN[label]) label = LABEL_EN[label];
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
        (people > 0 ? '<span class="ev-people"><span class="faces">' + faces + '</span>+' + people + (EN ? ' interested' : ' interesados') + '</span>' : '') +
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
          '<a class="live-more" href="' + href + '" rel="noopener"><b>' + (EN ? 'And many more plans in the app' : 'Y muchos más planes en la app') + '</b><span>' + (EN ? 'Get Nexo →' : 'Descargar Nexo →') + '</span></a>';
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
