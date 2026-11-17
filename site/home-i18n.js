/* Idioma de la web: español para quien tiene el móvil en español (o catalán, euskera,
 * gallego); inglés para el resto. Se puede forzar con ?lang=es / ?lang=en o con el
 * selector del pie, que se recuerda en este navegador. */
(function () {
  var SPANISH = /^(es|ca|eu|gl)\b/i;
  function pick() {
    try {
      var q = new URLSearchParams(location.search).get('lang');
      if (q === 'es' || q === 'en') {
        try { localStorage.setItem('nexo_lang', q); } catch (e) {}
        return q;
      }
      var saved = null;
      try { saved = localStorage.getItem('nexo_lang'); } catch (e) {}
      if (saved === 'es' || saved === 'en') return saved;
    } catch (e) {}
    var langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'es']);
    return SPANISH.test(langs[0] || 'es') ? 'es' : 'en';
  }
  var lang = pick();
  window.NEXO_LANG = lang;
  document.documentElement.lang = lang;
  if (lang === 'en') {
    // Ocultar un instante hasta traducir, para no ver el texto en español.
    document.documentElement.classList.add('i18n-pending');
    setTimeout(function () { document.documentElement.classList.remove('i18n-pending'); }, 1500);
  }
})();
