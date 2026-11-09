/* Applica tema e testo scelti nel Profilo → Aspetto prima che l'app parta (niente lampo del tema sbagliato).
   File esterno e non codice dentro index.html: così la politica di sicurezza dei contenuti può vietare il codice in linea. */
/* tema scelto nel Profilo → Aspetto, applicato prima che l'app parta */
(function () {
  try {
    var c = localStorage.getItem('gdl-theme') || 'auto';
    var t = c === 'auto' ? (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'notturno' : 'gesso') : c;
    document.documentElement.setAttribute('data-theme', t);
    var bar = { gesso: '#1B6A43', notturno: '#0F1A14', figurina: '#C81E36', azzurro: '#0B4EA2', tramonto: '#1E1219', contrasto: '#000000' }[t];
    if (t === 'custom') {
      /* tema personalizzato: i colori già calcolati (con i contrasti garantiti) salvati dall'app */
      var v = JSON.parse(localStorage.getItem('gdl-custom-vars') || '{}');
      for (var k in v) document.documentElement.style.setProperty(k, v[k]);
      bar = v['--turf'];
    }
    if (bar) document.querySelector('meta[name="theme-color"]').setAttribute('content', bar);
    /* dimensione e spaziatura del testo scelte nel Profilo → Aspetto */
    var tx = JSON.parse(localStorage.getItem('gdl-text') || 'null');
    if (tx) {
      document.documentElement.style.setProperty('--text-scale', String((tx.scale || 100) / 100));
      document.documentElement.style.setProperty('--text-spacing', String((tx.spacing || 0) / 100));
    }
  } catch (e) {}
})();
