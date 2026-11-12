/* Applica tema e testo scelti nel Profilo → Aspetto prima che l'app parta (niente lampo del tema sbagliato).
   File esterno e non codice dentro index.html: così la politica di sicurezza dei contenuti può vietare il codice in linea. */
/* tema scelto nel Profilo → Aspetto, applicato prima che l'app parta */
(function () {
  try {
    var c = localStorage.getItem('gdl-theme') || 'auto';
    var t = c === 'auto' ? (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'notturno' : 'gesso') : c;
    document.documentElement.setAttribute('data-theme', t);
    /* Rilievo e Rientranza (neumorphism): base chiara o scura */
    var key = t;
    if (t === 'rilievo' || t === 'rientranza') {
      var nb = localStorage.getItem('gdl-neu') === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-base', nb);
      if (nb === 'dark') key = t + ':dark';
    }
    var bar = { gesso: '#1B6A43', notturno: '#0F1A14', figurina: '#C81E36', azzurro: '#0B4EA2', tramonto: '#1E1219', contrasto: '#000000',
                rilievo: '#1B6A43', 'rilievo:dark': '#1C2026', rientranza: '#1B6A43', 'rientranza:dark': '#1C2026' }[key];
    /* tavolozza scelta per il tema: colori già calcolati dall'app (contrasti garantiti) */
    var pv = (JSON.parse(localStorage.getItem('gdl-palette-vars') || '{}') || {})[key];
    if (pv && t !== 'custom') {
      for (var pk in pv) document.documentElement.style.setProperty(pk, pv[pk]);
      bar = pv['--bar'] || bar;
    }
    if (t === 'custom') {
      /* tema personalizzato: i colori già calcolati (con i contrasti garantiti) salvati dall'app */
      var v = JSON.parse(localStorage.getItem('gdl-custom-vars') || '{}');
      for (var k in v) document.documentElement.style.setProperty(k, v[k]);
      bar = v['--turf'];
    }
    if (bar) document.querySelector('meta[name="theme-color"]').setAttribute('content', bar);
    /* dimensione e spaziatura del testo scelte nel Profilo → Aspetto */
    /* «Automatico»: testo più piccolo del 10% (data-auto, vedi styles.scss e core/theme.ts) */
    if (c === 'auto') document.documentElement.setAttribute('data-auto', '');
    var tx = JSON.parse(localStorage.getItem('gdl-text') || 'null');
    if (tx) {
      document.documentElement.style.setProperty('--text-scale', String((tx.scale || 100) / 100));
      document.documentElement.style.setProperty('--text-spacing', String((tx.spacing || 0) / 100));
    }
  } catch (e) {}
})();
