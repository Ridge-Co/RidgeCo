// Spanish layer for the tenant portal (queue #105, Nov 22 2026). Client-only and opt-in: English stays the default, the choice is kept in
// this browser's localStorage (no Tenants column: a schema change is a separate gated step). Display-only: only EXACT dictionary matches
// are translated, so work-order text, names, addresses, notes and stored status values are never altered.
// Own global names (TENANT_ES, tenantT, TLANG) so it cannot collide with vendor-i18n.js.
var TLANG = 'en';
var TENANT_LANG_KEY = 'ridgeco_tenant_lang';
try { TLANG = (localStorage.getItem(TENANT_LANG_KEY) === 'es') ? 'es' : 'en'; }
catch (e) { console.error('tenant language choice could not be read; using English', e); }   // storage blocked: English, page keeps working
var TENANT_ES = {
  // login
  'RIDGE CO': 'RIDGE CO', 'TENANT PORTAL': 'PORTAL DE INQUILINOS', 'Ridge Co — Tenant Portal': 'Ridge Co — Portal de Inquilinos',
  'FIRST NAME': 'PRIMER NOMBRE', '(e.g. Janice, Troy)': '(p. ej., Janice, Troy)', 'Your first name': 'Su primer nombre',
  'YOUR ACCESS PIN': 'SU PIN DE ACCESO', 'SIGN IN': 'INICIAR SESIÓN', 'LOG OUT': 'CERRAR SESIÓN',
  'Your PIN is provided by your property manager.': 'Su PIN se lo da su administrador de la propiedad.',
  'Contact them if you need access.': 'Comuníquese con él o ella si necesita acceso.',
  'PIN must be 8 characters (3 letters + 5 digits)': 'El PIN debe tener 8 caracteres (3 letras + 5 números)',
  'Please enter your first name.': 'Por favor escriba su primer nombre.',
  'Session failed': 'No se pudo iniciar la sesión',
  'Your session has ended. Please sign in again.': 'Su sesión terminó. Por favor inicie sesión de nuevo.',
  'Your session has expired.': 'Su sesión expiró.',
  'Please sign in again to see your requests.': 'Por favor inicie sesión de nuevo para ver sus solicitudes.',
  'SIGN IN AGAIN': 'INICIAR SESIÓN DE NUEVO',
  // dashboard
  'Open:': 'Abiertas:', 'Completed:': 'Completadas:', '+ SUBMIT A NEW REQUEST': '+ ENVIAR UNA NUEVA SOLICITUD',
  'SUBMIT A NEW REQUEST': 'ENVIAR UNA NUEVA SOLICITUD', '+ SUBMIT A REQUEST': '+ ENVIAR UNA SOLICITUD', 'Submit a New Request': 'Enviar una nueva solicitud',
  'All Work Orders': 'Todas las órdenes de trabajo', 'Open / In Progress': 'Abiertas / En progreso', 'Completed': 'Completadas',
  'Search…': 'Buscar…', 'Loading your work orders…': 'Cargando sus órdenes de trabajo…',
  'Nothing here yet': 'Aún no hay nada aquí', 'Maintenance requests for your home will show up here.': 'Las solicitudes de mantenimiento de su hogar aparecerán aquí.',
  'No matches': 'Sin resultados', 'None of your work orders match the current filter or search.': 'Ninguna de sus órdenes de trabajo coincide con el filtro o la búsqueda.',
  'SHOW ALL WORK ORDERS': 'MOSTRAR TODAS LAS ÓRDENES DE TRABAJO',
  "We couldn't load your work orders.": 'No pudimos cargar sus órdenes de trabajo.', 'TRY AGAIN': 'REINTENTAR',
  'Check your connection and try again. Your requests are safe — nothing was lost.': 'Revise su conexión e intente de nuevo. Sus solicitudes están a salvo — no se perdió nada.',
  'The connection timed out. Check your signal and try again. Your requests are safe — nothing was lost.': 'Se agotó el tiempo de conexión. Revise su señal e intente de nuevo. Sus solicitudes están a salvo — no se perdió nada.',
  'The server sent back something unexpected.': 'El servidor respondió algo inesperado.',
  'Connection error': 'Error de conexión', 'Connection error.': 'Error de conexión.',
  'Update ready — tap to refresh': 'Actualización lista — toque para actualizar',
  'Unknown Property': 'Propiedad desconocida', 'Maintenance Request': 'Solicitud de mantenimiento', 'No description provided.': 'No se dio ninguna descripción.',
  'STATUS TIMELINE': 'LÍNEA DE TIEMPO DEL ESTADO', 'None yet': 'Aún ninguno',
  // statuses (display only; stored values stay English)
  'New': 'Nueva', 'Assigned': 'Asignada', 'Accepted': 'Aceptada', 'In Progress': 'En progreso', 'On Hold': 'En espera', 'On hold': 'En espera',
  'Pending Invoice': 'Pendiente de factura', 'Invoice submitted': 'Factura enviada', 'Complete': 'Completa', 'Scheduled': 'Programada',
  'Technician assigned': 'Técnico asignado', 'Technician confirmed': 'Técnico confirmado', 'Work in progress': 'Trabajo en progreso',
  'Work complete': 'Trabajo terminado', 'Request received': 'Solicitud recibida', 'Request declined': 'Solicitud rechazada',
  'Technician phone': 'Teléfono del técnico', 'Please contact your property manager directly.': 'Por favor comuníquese directamente con su administrador de la propiedad.',
  '🏠 HANDLED BY YOUR PROPERTY OWNER': '🏠 A CARGO DEL DUEÑO DE SU PROPIEDAD', '🏠 Handled by your landlord': '🏠 A cargo de su arrendador',
  // new request / information
  'ADD INFORMATION': 'AGREGAR INFORMACIÓN', '+ ADD INFORMATION': '+ AGREGAR INFORMACIÓN', 'REPORT ISSUE': 'REPORTAR UN PROBLEMA',
  'REPORT ISSUE / REQUEST FEATURE': 'REPORTAR UN PROBLEMA / SUGERIR UNA FUNCIÓN',
  'This is for issues Ridge Co handles at your property. Your property manager is notified as soon as you submit.': 'Esto es para problemas que Ridge Co atiende en su propiedad. Su administrador de la propiedad recibe aviso en cuanto usted lo envíe.',
  'Type of Issue': 'Tipo de problema', 'Select…': 'Seleccione…', 'Describe the Issue': 'Describa el problema',
  "What's happening? When did it start? Is it getting worse?": '¿Qué está pasando? ¿Cuándo empezó? ¿Está empeorando?',
  'How Urgent Is This?': '¿Qué tan urgente es?', 'Urgent — needs prompt attention': 'Urgente — necesita atención pronta',
  'Normal — schedule when available': 'Normal — programar cuando se pueda', 'Low — no rush': 'Baja — sin prisa',
  'Photos / Video': 'Fotos / Video', 'Photos': 'Fotos', '(optional — helps us fix it faster)': '(opcional — nos ayuda a arreglarlo más rápido)',
  '📷 PHOTOS & FILES': '📷 FOTOS Y ARCHIVOS', 'SUBMIT': 'ENVIAR', 'Cancel': 'Cancelar', 'SEND': 'ENVIAR',
  'Please describe the issue.': 'Por favor describa el problema.', 'Please select the type of issue.': 'Por favor seleccione el tipo de problema.',
  'Error submitting request': 'Error al enviar la solicitud',
  'Share additional details with your property manager. This cannot be edited after submission.': 'Comparta más detalles con su administrador de la propiedad. No se puede editar después de enviarlo.',
  'Provide additional details, availability, or updates to your property manager.': 'Dé más detalles, su disponibilidad o novedades a su administrador de la propiedad.',
  'e.g. The leak is getting worse after rain. I\'m available Tuesday afternoon after 3pm…': 'p. ej., La fuga empeora cuando llueve. Estoy disponible el martes por la tarde después de las 3 pm…',
  '✓ Sent to your property manager.': '✓ Enviado a su administrador de la propiedad.', '✓ Sent — thank you!': '✓ ¡Enviado — gracias!',
  "Couldn't load photos": 'No se pudieron cargar las fotos', '↑ Uploading…': '↑ Subiendo…', '⚠ Upload failed': '⚠ Falló la carga',
  // trades
  'Appliance': 'Electrodomésticos', 'HVAC': 'Aire acondicionado y calefacción', 'Locks': 'Cerraduras', 'General': 'General', 'Painting': 'Pintura',
  'Carpentry': 'Carpintería', 'Flooring': 'Pisos', 'Plumbing': 'Plomería', 'Roofing': 'Techos', 'Landscaping': 'Jardinería', 'Cleaning': 'Limpieza',
  'Pest Control': 'Control de plagas', 'Windows': 'Ventanas', 'Electrical': 'Electricidad',
  // feedback
  '💬 Feedback': '💬 Comentarios', "🐛 Something isn't working": '🐛 Algo no funciona', '💡 Suggestion': '💡 Sugerencia', '💬 Other feedback': '💬 Otros comentarios',
  'Describe the issue or suggestion…': 'Describa el problema o la sugerencia…',
  "Couldn't send your feedback. Please try again.": 'No pudimos enviar sus comentarios. Por favor intente de nuevo.',
  'Connection error — your feedback was not sent. Please try again.': 'Error de conexión — sus comentarios no se enviaron. Por favor intente de nuevo.',
  // voice
  'Voice to text': 'Voz a texto'
};
var _tLower = null;
function _tDict() {
  if (_tLower) return _tLower;
  _tLower = {};
  for (var k in TENANT_ES) { if (Object.prototype.hasOwnProperty.call(TENANT_ES, k)) _tLower[k.replace(/[‘’]/g, "'").toLowerCase()] = TENANT_ES[k]; }
  return _tLower;
}
function tenantT(s) {
  if (TLANG !== 'es' || !s) return s;
  var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), lead = m[1], core = m[2], tail = m[3];
  if (!core || !/[A-Za-z]{2}/.test(core)) return s;
  var d = _tDict();
  function look(c) {
    c = c.replace(/[‘’]/g, "'");
    var hit = d[c.toLowerCase()];
    if (hit === undefined) return null;
    if (c === c.toUpperCase() && /[A-Z]/.test(c)) return hit.toUpperCase();
    return hit;
  }
  var out = look(core);
  if (out === null) {
    var p = /^([^A-Za-z0-9¿¡]*)([\s\S]*?)([\s:…*.✓✔—–-]*)$/.exec(core);
    if (p && p[2]) { var a = look(p[2] + p[3]); if (a !== null) out = p[1] + a; else { var b = look(p[2]); if (b !== null) out = p[1] + b + p[3]; } }
  }
  return out === null ? s : lead + out + tail;
}
function tenantTranslateTree(root) {
  if (TLANG !== 'es' || !root) return;
  var skip = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1 };
  function attrs(el) {
    ['placeholder', 'title', 'aria-label'].forEach(function (a) { var v = el.getAttribute && el.getAttribute(a); if (v) { var n = tenantT(v); if (n !== v) el.setAttribute(a, n); } });
  }
  function walk(n) {
    if (n.nodeType === 3) { var t = n.nodeValue, r = tenantT(t); if (r !== t) n.nodeValue = r; return; }
    if (n.nodeType !== 1 || n.hasAttribute('data-notranslate')) return;
    attrs(n);
    if (skip[n.tagName]) return;
    for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
  }
  walk(root);
}
var _tObs = null;
function tenantStartObserver() {
  if (_tObs || TLANG !== 'es' || typeof MutationObserver === 'undefined') return;
  var busy = false;
  _tObs = new MutationObserver(function (muts) {
    if (busy) return; busy = true;
    try {
      muts.forEach(function (m) {
        if (m.type === 'characterData') { var t = m.target.nodeValue, r = tenantT(t); if (r !== t) m.target.nodeValue = r; }
        else if (m.type === 'attributes') { var v = m.target.getAttribute(m.attributeName), n = tenantT(v); if (v && n !== v) m.target.setAttribute(m.attributeName, n); }
        else m.addedNodes.forEach(function (n) { tenantTranslateTree(n); });
      });
    } finally { busy = false; }
  });
  _tObs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] });
}
// EN | ES buttons: drawn into every element with class tenant-lang-toggle (login card + dashboard header).
function tenantSetLang(l) {
  var next = (l === 'es') ? 'es' : 'en';
  try { localStorage.setItem(TENANT_LANG_KEY, next); } catch (e) { console.error('tenant language choice not stored (this tab only)', e); }
  if (next === TLANG) return;
  if (next === 'en') { location.reload(); return; }   // English strings are not kept after translating, so a reload restores them
  TLANG = 'es';
  document.documentElement.lang = 'es';
  tenantTranslateTree(document.body);
  tenantStartObserver();
  tenantDrawToggles();
}
function tenantDrawToggles() {
  var boxes = document.querySelectorAll('.tenant-lang-toggle');
  for (var i = 0; i < boxes.length; i++) {
    boxes[i].setAttribute('data-notranslate', '');
    boxes[i].innerHTML = ['en', 'es'].map(function (c) {
      var on = (c === TLANG);
      return '<button type="button" onclick="tenantSetLang(\'' + c + '\')" aria-pressed="' + on + '" aria-label="' + (c === 'es' ? 'Español' : 'English') + '" style="min-height:44px;min-width:48px;padding:0 10px;border:1px solid var(--border);' +
        'background:' + (on ? 'var(--accent)' : 'var(--surface2)') + ';color:' + (on ? '#fff' : 'var(--text)') + ';font-family:var(--font);font-size:13px;font-weight:bold;cursor:pointer;border-radius:' + (c === 'en' ? '6px 0 0 6px' : '0 6px 6px 0') + '">' + c.toUpperCase() + '</button>';
    }).join('');
  }
}
document.addEventListener('DOMContentLoaded', function () {
  tenantDrawToggles();
  if (TLANG === 'es') { document.documentElement.lang = 'es'; tenantTranslateTree(document.body); tenantStartObserver(); }
});
(function () {   // alert / confirm / prompt text is not in the DOM, so translate it at the call
  var a = window.alert, c = window.confirm, p = window.prompt;
  window.alert = function (m) { return a.call(window, tenantT(String(m))); };
  window.confirm = function (m) { return c.call(window, tenantT(String(m))); };
  window.prompt = function (m, d) { return p.call(window, tenantT(String(m)), d); };
})();
