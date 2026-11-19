/* intake-flow.js - guided request with emergency catch, Phase 1 of 5 (queue #116, Nov 19 2026).
 * Shared by submit.html and tenant.html so both forms behave the same (one flow, not two).
 * It holds: the emergency list, the question bank per trade, the approved self-checks (English + Spanish),
 * one pure function that turns answers into a plain English summary, and the step-by-step screen.
 * No AI, no network of its own: the page passes `file(body)` which files the request and returns a promise.
 * If this file fails to load, or anything in mount() throws, the page keeps its old single form (a request can always be filed).
 * The SERVER decides "emergency" again (worker.js intakeDecide), so this page is never the only line of defence.
 */
(function (root) {
  'use strict';

  // Emergency list (default, queue #116 question 1). Brett can change the server-side word list in Config intake_emergency_words.
  var EMERGENCIES = [
    { id: 'fire_smoke', en: 'Fire or smoke', es: 'Fuego o humo' },
    { id: 'gas', en: 'Smell of gas', es: 'Olor a gas' },
    { id: 'co', en: 'Carbon monoxide alarm', es: 'Alarma de monóxido de carbono' },
    { id: 'water', en: 'Water that will not stop (burst pipe, flooding)', es: 'Agua que no se detiene (tubo roto, inundación)' },
    { id: 'sewage', en: 'Sewage backing up', es: 'Aguas negras que regresan' },
    { id: 'no_heat', en: 'No heat and it is freezing outside', es: 'Sin calefacción y hace mucho frío afuera' },
    { id: 'no_power', en: 'No power in the whole unit', es: 'Sin electricidad en toda la unidad' },
    { id: 'door', en: 'An outside door will not lock', es: 'Una puerta exterior no cierra con llave' }
  ];

  var WHEN = { id: 'when', en: 'When did it start?', es: '¿Cuándo empezó?', options: [
    { v: 'today', en: 'Today', es: 'Hoy' }, { v: 'week', en: 'This week', es: 'Esta semana' }, { v: 'longer', en: 'Longer ago', es: 'Hace más tiempo' }] };
  var WHERE = { id: 'where', en: 'Where in the home?', es: '¿En qué parte de la casa?', options: [
    { v: 'kitchen', en: 'Kitchen', es: 'Cocina' }, { v: 'bath', en: 'Bathroom', es: 'Baño' }, { v: 'bedroom', en: 'Bedroom', es: 'Dormitorio' },
    { v: 'living', en: 'Living area', es: 'Sala' }, { v: 'other', en: 'Somewhere else', es: 'Otro lugar' }] };

  // Question bank: at most 4 follow-ups per trade, each can be skipped. Option values are what the summary prints (English, fixed).
  var BANK = {
    Plumbing: [
      { id: 'what', en: 'What is wrong?', es: '¿Qué pasa?', options: [{ v: 'leak', en: 'A leak or drip', es: 'Una fuga o goteo' }, { v: 'clog', en: 'Clogged drain or toilet', es: 'Desagüe o inodoro tapado' }, { v: 'nowater', en: 'No water', es: 'No hay agua' }, { v: 'toilet', en: 'Toilet keeps running', es: 'El inodoro no deja de correr' }, { v: 'other', en: 'Something else', es: 'Otra cosa' }] },
      WHERE,
      { id: 'stopped', en: 'Can you stop the water (turn the valve)?', es: '¿Puede detener el agua (cerrar la llave)?', options: [{ v: 'yes', en: 'Yes, stopped', es: 'Sí, se detuvo' }, { v: 'no', en: 'No', es: 'No' }, { v: 'na', en: 'Not a water leak', es: 'No es una fuga' }] },
      WHEN],
    Electrical: [
      { id: 'what', en: 'What is wrong?', es: '¿Qué pasa?', options: [{ v: 'outlet', en: 'Outlet has no power', es: 'Un enchufe no tiene corriente' }, { v: 'lights', en: 'Lights not working', es: 'Las luces no funcionan' }, { v: 'breaker', en: 'Breaker keeps tripping', es: 'El interruptor se dispara' }, { v: 'other', en: 'Something else', es: 'Otra cosa' }] },
      WHERE,
      { id: 'burn', en: 'Any burning smell, sparks or buzzing?', es: '¿Olor a quemado, chispas o zumbido?', options: [{ v: 'no', en: 'No', es: 'No' }, { v: 'yes', en: 'Yes', es: 'Sí' }] },
      WHEN],
    HVAC: [
      { id: 'what', en: 'What is wrong?', es: '¿Qué pasa?', options: [{ v: 'noheat', en: 'No heat', es: 'No hay calefacción' }, { v: 'nocool', en: 'No cooling', es: 'No enfría' }, { v: 'noise', en: 'Strange noise or smell', es: 'Ruido u olor extraño' }, { v: 'other', en: 'Something else', es: 'Otra cosa' }] },
      { id: 'thermo', en: 'What does the thermostat screen show?', es: '¿Qué muestra la pantalla del termostato?', options: [{ v: 'blank', en: 'Blank screen', es: 'Pantalla en blanco' }, { v: 'shows', en: 'It shows a temperature', es: 'Muestra una temperatura' }] },
      WHEN],
    Appliance: [
      { id: 'which', en: 'Which appliance?', es: '¿Qué aparato?', options: [{ v: 'fridge', en: 'Refrigerator', es: 'Refrigerador' }, { v: 'stove', en: 'Stove or oven', es: 'Estufa u horno' }, { v: 'washer', en: 'Washer or dryer', es: 'Lavadora o secadora' }, { v: 'dishwasher', en: 'Dishwasher', es: 'Lavavajillas' }, { v: 'disposal', en: 'Garbage disposal', es: 'Triturador de basura' }, { v: 'other', en: 'Other', es: 'Otro' }] },
      { id: 'what', en: 'What is it doing?', es: '¿Qué hace?', options: [{ v: 'nostart', en: 'Will not start or hums', es: 'No enciende o zumba' }, { v: 'leaking', en: 'Leaking', es: 'Gotea' }, { v: 'noise', en: 'Loud noise', es: 'Ruido fuerte' }, { v: 'temp', en: 'Not cooling / not heating', es: 'No enfría / no calienta' }] },
      WHEN],
    General: [WHERE, WHEN]
  };
  ['Carpentry', 'Painting', 'Flooring', 'Roofing', 'Windows', 'Locks', 'Landscaping', 'Cleaning', 'Pest Control'].forEach(function (t) { BANK[t] = [WHERE, WHEN]; });
  var TRADES = [
    { v: 'Plumbing', en: 'Plumbing', es: 'Plomería' }, { v: 'Electrical', en: 'Electrical', es: 'Electricidad' }, { v: 'HVAC', en: 'Heating / cooling', es: 'Calefacción / aire' },
    { v: 'Appliance', en: 'Appliance', es: 'Electrodoméstico' }, { v: 'General', en: 'Something else', es: 'Otra cosa' }, { v: 'Carpentry', en: 'Carpentry', es: 'Carpintería' },
    { v: 'Painting', en: 'Painting', es: 'Pintura' }, { v: 'Flooring', en: 'Flooring', es: 'Pisos' }, { v: 'Roofing', en: 'Roof', es: 'Techo' }, { v: 'Windows', en: 'Windows', es: 'Ventanas' },
    { v: 'Locks', en: 'Locks', es: 'Cerraduras' }, { v: 'Landscaping', en: 'Yard', es: 'Jardín' }, { v: 'Cleaning', en: 'Cleaning', es: 'Limpieza' }, { v: 'Pest Control', en: 'Pests', es: 'Plagas' }
  ];

  // Approved self-checks only (queue #116 question 5). None touches gas, water heaters, or an electrical panel beyond a breaker reset. Never shown for an emergency.
  var SELF_CHECKS = [
    { id: 'breaker', trade: 'Electrical', when: { what: 'breaker' }, en: 'Open the electrical panel and look for a switch that sits halfway or in the OFF position. Push it fully to OFF, then back to ON. If it trips again right away, stop and tap "Still broken".', es: 'Abra el panel eléctrico y busque un interruptor que esté a medias o en OFF. Empújelo completamente a OFF y luego a ON. Si se dispara otra vez de inmediato, pare y toque "Sigue sin funcionar".' },
    { id: 'gfci', trade: 'Electrical', when: { what: 'outlet' }, en: 'Look for an outlet with TEST and RESET buttons (often in a bathroom, kitchen or garage). Press RESET firmly. That outlet can power other outlets on the same wall.', es: 'Busque un enchufe con botones TEST y RESET (a menudo en el baño, la cocina o el garaje). Presione RESET con firmeza. Ese enchufe puede dar corriente a otros de la misma pared.' },
    { id: 'disposal', trade: 'Appliance', when: { which: 'disposal' }, en: 'Look under the disposal for a small red RESET button. Press it once, wait a minute, then try the switch again.', es: 'Mire debajo del triturador: hay un botón rojo pequeño de RESET. Presiónelo una vez, espere un minuto y pruebe el interruptor otra vez.' },
    { id: 'thermo', trade: 'HVAC', when: { thermo: 'blank' }, en: 'A blank thermostat often needs new batteries. Replace them with fresh ones and wait two minutes.', es: 'Un termostato en blanco a menudo necesita pilas nuevas. Cámbielas por pilas nuevas y espere dos minutos.' }
  ];

  var UI = {
    en: { yesNow: 'Is any of this happening right now?', none: 'None of these', trade: 'What kind of problem is it?', next: 'Next', skip: 'Skip', back: 'Back', tryFirst: 'Try this first', fixed: 'That fixed it', still: 'Still broken', describe: 'Tell us more', descHint: 'What is happening? Anything we should know?', photos: 'Photos (optional)', send: 'Send request', sending: 'Sending...', priority: 'How urgent is it?', pNormal: 'Normal', pLow: 'Low, no rush', pUrgent: 'Urgent', needDesc: 'Please add a few words about the problem.', failed: 'Not sent. Your answers are saved, please try again.', retry: 'Try again', call: 'Call us now', offline: 'You look offline. Reconnect, then tap Send.', sent: 'Request sent', sentSub: 'You do not need to do anything else.', ref: 'Reference', another: 'Report another problem', emTitle: 'Stay safe first', emBody: 'If anyone is in danger, call 911. If you can do it safely, shut off the water or gas, or leave the home.', emAlerted: 'We have alerted Ridge Co. Call us now if you can.', emSending: 'Telling Ridge Co now...', emFail: 'Not sent, please try again. If anyone is in danger, call 911 now.', fixedThanks: 'Glad it is working. Nothing was filed. If it breaks again, send a request any time.', lang: 'Español', photoFail: 'Your request was sent, but some photos did not upload. You can add them from your requests list.', step: 'Step' },
    es: { yesNow: '¿Está pasando algo de esto ahora mismo?', none: 'Ninguna de estas', trade: '¿Qué tipo de problema es?', next: 'Siguiente', skip: 'Omitir', back: 'Atrás', tryFirst: 'Pruebe esto primero', fixed: 'Eso lo arregló', still: 'Sigue sin funcionar', describe: 'Cuéntenos más', descHint: '¿Qué está pasando? ¿Algo que debamos saber?', photos: 'Fotos (opcional)', send: 'Enviar solicitud', sending: 'Enviando...', priority: '¿Qué tan urgente es?', pNormal: 'Normal', pLow: 'Baja, sin prisa', pUrgent: 'Urgente', needDesc: 'Por favor escriba unas palabras sobre el problema.', failed: 'No se envió. Sus respuestas están guardadas, intente de nuevo.', retry: 'Intentar de nuevo', call: 'Llámenos ahora', offline: 'Parece que no hay conexión. Reconéctese y toque Enviar.', sent: 'Solicitud enviada', sentSub: 'No necesita hacer nada más.', ref: 'Referencia', another: 'Reportar otro problema', emTitle: 'Primero su seguridad', emBody: 'Si alguien está en peligro, llame al 911. Si puede hacerlo con seguridad, cierre el agua o el gas, o salga de la casa.', emAlerted: 'Hemos avisado a Ridge Co. Llámenos ahora si puede.', emSending: 'Avisando a Ridge Co...', emFail: 'No se envió, intente de nuevo. Si alguien está en peligro, llame al 911 ahora.', fixedThanks: 'Qué bueno que funciona. No se envió nada. Si falla otra vez, envíe una solicitud cuando quiera.', lang: 'English', photoFail: 'Su solicitud se envió, pero algunas fotos no se subieron. Puede agregarlas desde su lista de solicitudes.', step: 'Paso' }
  };

  function pick(o, lang) { return (lang === 'es' && o.es) ? o.es : o.en; }
  function find(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i].v === v || arr[i].id === v) return arr[i]; return null; }

  // Pure: answers -> plain English lines for Brett (fixed options, so always English whatever language the tenant used).
  function buildSummary(trade, answers, o) {
    o = o || {};
    var qs = BANK[trade] || BANK.General, lines = [];
    qs.forEach(function (q) {
      var a = answers && answers[q.id]; if (!a) return;
      var opt = find(q.options, a);
      lines.push(q.en.replace(/\?$/, '') + ': ' + (opt ? opt.en : String(a)));
    });
    if (o.selfCheck) lines.push('Self-check tried: ' + o.selfCheck + ' (still broken)');
    if (o.emergency) lines.unshift('EMERGENCY: ' + o.emergency);
    return { lines: lines, text: lines.join('\n') };
  }
  function selfCheckFor(trade, answers) {
    for (var i = 0; i < SELF_CHECKS.length; i++) {
      var c = SELF_CHECKS[i]; if (c.trade !== trade) continue;
      var ok = true; for (var k in c.when) if ((answers || {})[k] !== c.when[k]) ok = false;
      if (ok) return c;
    }
    return null;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  var CSS = '.rci{font-size:15px;line-height:1.45;color:var(--text)}.rci h2{font-size:20px;line-height:1.2;font-weight:700;margin:0 0 12px}.rci p{margin:0 0 12px}' +
    '.rci .rci-btn{display:block;width:100%;min-height:44px;margin:0 0 8px;padding:10px 14px;border-radius:var(--radius,8px);border:1px solid var(--border);background:var(--surface);color:var(--text);font:600 15px var(--font,sans-serif);text-align:left;cursor:pointer}' +
    '.rci .rci-btn:disabled{opacity:.5;cursor:not-allowed}.rci .rci-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;text-align:center}' +
    '.rci .rci-btn.sel{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent)}.rci .rci-btn.quiet{background:var(--surface2)}.rci .rci-btn.danger{background:var(--danger);border-color:var(--danger);color:#fff;text-align:left}' +
    '.rci .rci-q{margin:0 0 16px}.rci .rci-q b{display:block;font-size:15px;margin-bottom:6px}.rci .rci-opts{display:flex;flex-wrap:wrap;gap:8px}.rci .rci-opts .rci-btn{width:auto;margin:0;text-align:center}' +
    '.rci .rci-em{border:2px solid var(--danger);background:var(--danger-bg,#fdecea);border-radius:var(--radius,8px);padding:16px;margin-bottom:12px}.rci .rci-em h2{color:var(--danger)}' +
    '.rci .rci-ok{border:1px solid var(--accent2);background:var(--success-bg,#eaf6ee);border-radius:var(--radius,8px);padding:16px;margin-bottom:12px}' +
    '.rci .rci-err{color:var(--danger);font-weight:600;margin:8px 0}.rci .rci-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:13px;color:var(--muted)}' +
    '.rci .rci-lang{min-height:44px;background:none;border:none;color:var(--accent);font:600 13px var(--font,sans-serif);cursor:pointer;padding:0 4px}' +
    '.rci textarea,.rci select{width:100%;font-size:16px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius,8px);background:var(--surface2);color:var(--text);font-family:var(--font,sans-serif)}.rci textarea{min-height:100px}' +
    '.rci a.rci-call{display:flex;align-items:center;justify-content:center;min-height:44px;margin:0 0 8px;border-radius:var(--radius,8px);background:var(--danger);color:#fff;font:600 15px var(--font,sans-serif);text-decoration:none}';

  // mount(opts): opts.root (element), opts.phone, opts.lang, opts.file(body) -> Promise<{id, intake, photoFailures}>, opts.deflected(info) (optional),
  // opts.photoSlot (element holding the page's photo picker, shown on the last step), opts.hide (elements to hide while guided), opts.reset() (start over)
  function mount(opts) {
    var rootEl = opts.root, S = { step: 'emerg', lang: opts.lang === 'es' ? 'es' : (/^es\b/i.test(navigator.language || '') && !opts.lang ? 'es' : 'en'), emergency: '', trade: '', answers: {}, selfCheck: '', desc: '', priority: 'normal', busy: false, error: '', done: null, em: null };
    if (!document.getElementById('rci-css')) { var st = document.createElement('style'); st.id = 'rci-css'; st.textContent = CSS; document.head.appendChild(st); }
    (opts.hide || []).forEach(function (e) { if (e) e.style.display = 'none'; });
    if (opts.photoSlot) { opts.photoSlot.style.display = 'none'; }
    var T = function (k) { return UI[S.lang][k]; };
    var callBtn = function (cls) { return opts.phone ? '<a class="rci-call" href="tel:' + esc(String(opts.phone).replace(/[^0-9+]/g, '')) + '">' + esc(T('call')) + '</a>' : ''; };
    function paint() {
      var h = '<div class="rci"><div class="rci-top"><span></span><button type="button" class="rci-lang" data-a="lang">' + esc(T('lang')) + '</button></div>';
      if (S.step === 'emerg') {
        h += '<h2>' + esc(T('yesNow')) + '</h2>';
        EMERGENCIES.forEach(function (e) { h += '<button type="button" class="rci-btn" data-a="em" data-v="' + e.id + '">' + esc(pick(e, S.lang)) + '</button>'; });
        h += '<button type="button" class="rci-btn primary" data-a="noem">' + esc(T('none')) + '</button>';
      } else if (S.step === 'emfiled') {
        var r = S.em;
        h += '<div class="rci-em"><h2>' + esc(T('emTitle')) + '</h2><p>' + esc(T('emBody')) + '</p>' + callBtn() + '</div>';
        if (r === 'sending') h += '<p>' + esc(T('emSending')) + '</p>';
        else if (r === 'fail') h += '<p class="rci-err" role="alert">' + esc(T('emFail')) + '</p><button type="button" class="rci-btn primary" data-a="emretry">' + esc(T('retry')) + '</button>';
        else h += '<div class="rci-ok"><p><b>' + esc(T('emAlerted')) + '</b></p><p>' + esc(T('ref')) + ': ' + esc(r && r.id) + '</p></div>';
      } else if (S.step === 'trade') {
        h += '<h2>' + esc(T('trade')) + '</h2><div class="rci-opts">';
        TRADES.forEach(function (t) { h += '<button type="button" class="rci-btn' + (S.trade === t.v ? ' sel' : '') + '" data-a="trade" data-v="' + esc(t.v) + '">' + esc(pick(t, S.lang)) + '</button>'; });
        h += '</div>';
      } else if (S.step === 'questions') {
        h += '<h2>' + esc(pick(find(TRADES, S.trade) || { en: S.trade }, S.lang)) + '</h2>';
        (BANK[S.trade] || BANK.General).forEach(function (q) {
          h += '<div class="rci-q"><b>' + esc(pick(q, S.lang)) + '</b><div class="rci-opts">';
          q.options.forEach(function (o) { h += '<button type="button" class="rci-btn' + (S.answers[q.id] === o.v ? ' sel' : '') + '" data-a="ans" data-q="' + q.id + '" data-v="' + o.v + '">' + esc(pick(o, S.lang)) + '</button>'; });
          h += '</div></div>';
        });
        h += '<button type="button" class="rci-btn primary" data-a="qnext">' + esc(T('next')) + '</button><button type="button" class="rci-btn quiet" data-a="back">' + esc(T('back')) + '</button>';
      } else if (S.step === 'selfcheck') {
        var c = selfCheckFor(S.trade, S.answers);
        h += '<h2>' + esc(T('tryFirst')) + '</h2><p>' + esc(pick(c, S.lang)) + '</p><button type="button" class="rci-btn primary" data-a="fixed">' + esc(T('fixed')) + '</button><button type="button" class="rci-btn" data-a="still">' + esc(T('still')) + '</button>';
      } else if (S.step === 'fixed') {
        h += '<div class="rci-ok"><h2>' + esc(T('fixed')) + '</h2><p>' + esc(T('fixedThanks')) + '</p></div><button type="button" class="rci-btn quiet" data-a="restart">' + esc(T('another')) + '</button>';
      } else if (S.step === 'final') {
        h += '<h2>' + esc(T('describe')) + '</h2><div class="rci-q"><textarea id="rci-desc" placeholder="' + esc(T('descHint')) + '"></textarea></div>' +
          '<div class="rci-q"><b>' + esc(T('priority')) + '</b><select id="rci-pri"><option value="normal">' + esc(T('pNormal')) + '</option><option value="low">' + esc(T('pLow')) + '</option><option value="urgent">' + esc(T('pUrgent')) + '</option></select></div>' +
          '<div class="rci-q" id="rci-photos"><b>' + esc(T('photos')) + '</b><div id="rci-photo-host"></div></div>' +
          (S.error ? '<p class="rci-err" role="alert">' + esc(S.error) + '</p>' : '') +
          '<button type="button" class="rci-btn primary" data-a="send"' + (S.busy ? ' disabled' : '') + '>' + esc(S.busy ? T('sending') : (S.error ? T('retry') : T('send'))) + '</button><button type="button" class="rci-btn quiet" data-a="back">' + esc(T('back')) + '</button>';
      } else if (S.step === 'done') {
        h += '<div class="rci-ok"><h2>' + esc(T('sent')) + '</h2><p>' + esc(T('sentSub')) + '</p><p>' + esc(T('ref')) + ': ' + esc(S.done && S.done.id) + '</p></div>' +
          (S.done && S.done.photoFailures ? '<p class="rci-err" role="alert">' + esc(T('photoFail')) + '</p>' : '') + '<button type="button" class="rci-btn quiet" data-a="restart">' + esc(T('another')) + '</button>';
      }
      rootEl.innerHTML = h + '</div>';
      var host = rootEl.querySelector('#rci-photo-host');
      if (host && opts.photoSlot) { opts.photoSlot.style.display = ''; host.appendChild(opts.photoSlot); }
      else if (opts.photoSlot) { opts.photoSlot.style.display = 'none'; }
      if (S.step === 'final') { var d = rootEl.querySelector('#rci-desc'); if (d) { d.value = S.desc; d.oninput = function () { S.desc = d.value; }; } var p = rootEl.querySelector('#rci-pri'); if (p) { p.value = S.priority; p.onchange = function () { S.priority = p.value; }; } }
    }
    function intakeBody(emergencyLabel) {
      var sum = buildSummary(S.trade || 'General', S.answers, { selfCheck: S.selfCheck, emergency: emergencyLabel });
      return { trade: S.trade || 'General', priority: emergencyLabel ? 'urgent' : S.priority, description: emergencyLabel ? ('EMERGENCY reported by tenant: ' + emergencyLabel) : S.desc.trim(),
        intake: { answers: S.answers, summary: sum.text, emergency: !!emergencyLabel, kind: emergencyLabel || '', lang: S.lang, channel: 'web', self_check: S.selfCheck } };
    }
    function fileEmergency() {
      S.em = 'sending'; paint();
      var e = find(EMERGENCIES, S.emergency);
      Promise.resolve().then(function () { return opts.file(intakeBody(e ? e.en : 'emergency')); }).then(function (r) {
        if (!r || !r.id) throw new Error('no id');
        S.em = r; paint();
      }).catch(function (err) { console.error('intake emergency filing failed', err); if (opts.report) opts.report('intake_emergency_file', err); S.em = 'fail'; paint(); });
    }
    function send() {
      if (S.busy) return;
      if (!S.desc.trim()) { S.error = T('needDesc'); paint(); return; }
      if (navigator.onLine === false) { S.error = T('offline'); paint(); return; }
      S.busy = true; S.error = ''; paint();
      Promise.resolve().then(function () { return opts.file(intakeBody('')); }).then(function (r) {
        if (!r || !r.id) throw new Error('no id');
        S.busy = false; S.done = r; S.step = 'done'; paint();
      }).catch(function (err) { console.error('intake filing failed', err); if (opts.report) opts.report('intake_file', err); S.busy = false; S.error = T('failed') + (err && err.message && !/^no id$/.test(err.message) ? ' (' + err.message + ')' : ''); paint(); });
    }
    function restart() { S.step = 'emerg'; S.emergency = ''; S.trade = ''; S.answers = {}; S.selfCheck = ''; S.desc = ''; S.priority = 'normal'; S.error = ''; S.done = null; S.em = null; if (opts.reset) opts.reset(); paint(); }
    rootEl.onclick = function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-a]') : null; if (!b || b.disabled) return;
      var a = b.getAttribute('data-a'), v = b.getAttribute('data-v');
      if (a === 'lang') { S.lang = S.lang === 'es' ? 'en' : 'es'; paint(); }
      else if (a === 'em') { S.emergency = v; S.step = 'emfiled'; fileEmergency(); }
      else if (a === 'emretry') { fileEmergency(); }
      else if (a === 'noem') { S.step = 'trade'; paint(); }
      else if (a === 'trade') { S.trade = v; S.answers = {}; S.step = 'questions'; paint(); }
      else if (a === 'ans') { var q = b.getAttribute('data-q'); S.answers[q] = (S.answers[q] === v) ? '' : v; if (!S.answers[q]) delete S.answers[q]; paint(); }
      else if (a === 'qnext') { S.step = selfCheckFor(S.trade, S.answers) ? 'selfcheck' : 'final'; paint(); }
      else if (a === 'fixed') { var c = selfCheckFor(S.trade, S.answers); S.step = 'fixed'; paint(); if (opts.deflected) { try { Promise.resolve(opts.deflected({ trade: S.trade, check: c ? c.id : '' })).catch(function (e) { console.error('intake deflected log failed', e); if (opts.report) opts.report('intake_deflected', e); }); } catch (e) { console.error(e); if (opts.report) opts.report('intake_deflected', e); } } }
      else if (a === 'still') { var c2 = selfCheckFor(S.trade, S.answers); S.selfCheck = c2 ? c2.id : ''; S.step = 'final'; paint(); }
      else if (a === 'back') { S.step = S.step === 'final' ? (selfCheckFor(S.trade, S.answers) ? 'selfcheck' : 'questions') : (S.step === 'questions' ? 'trade' : 'emerg'); S.error = ''; paint(); }
      else if (a === 'send') { send(); }
      else if (a === 'restart') { restart(); }
    };
    paint();
    return { restart: restart };
  }

  var api = { EMERGENCIES: EMERGENCIES, BANK: BANK, TRADES: TRADES, SELF_CHECKS: SELF_CHECKS, UI: UI, buildSummary: buildSummary, selfCheckFor: selfCheckFor, mount: mount };
  root.RCIntake = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
