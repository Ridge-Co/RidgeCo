/* vendor-i18n.js — universal Spanish layer for vendor.html (Oct 5 2026). Loaded before the main inline script;
   reads the page globals LANG and ES at call time. */

// ── Universal Spanish layer (Oct 5 2026) ─────────────────────────────────────────────────
// The first translation pass only wired t() into a few strings, so most of the portal (work-order
// cards, status buttons, forms, errors) stayed English for Spanish-speaking vendors. This layer
// translates whatever is ON SCREEN: it walks text nodes + placeholder/title/aria-label and swaps any
// string found in ES / ES_EXTRA, then a MutationObserver keeps doing it for everything rendered
// later (cards, modals, toasts). alert/confirm/prompt are translated too. Only exact dictionary
// matches are touched, so work-order text, names and addresses are never altered.
var ES_EXTRA = {
"VENDOR PORTAL": "PORTAL DE CONTRATISTAS",
"MY INFO": "MIS DATOS",
"FEEDBACK": "COMENTARIOS",
"Search by WO #, ref #, address, trade…": "Buscar por # de orden, referencia, dirección, oficio…",
"All Trades": "Todos los oficios",
"All Priorities": "Todas las prioridades",
"Priority": "Prioridad",
"Address A-Z": "Dirección A-Z",
"Newest First": "Más recientes primero",
"Oldest First": "Más antiguos primero",
"Plumbing": "Plomería",
"Electrical": "Electricidad",
"HVAC": "Aire acondicionado y calefacción",
"Appliance": "Electrodomésticos",
"General": "General",
"Carpentry": "Carpintería",
"Painting": "Pintura",
"Flooring": "Pisos",
"Roofing": "Techos",
"Windows": "Ventanas",
"Locks": "Cerraduras",
"Landscaping": "Jardinería",
"Cleaning": "Limpieza",
"Pest Control": "Control de plagas",
"Mechanic": "Mecánica",
"Urgent": "Urgente",
"High": "Alta",
"Normal": "Normal",
"Low": "Baja",
"Assigned": "Asignado",
"Accepted": "Aceptado",
"In Progress": "En progreso",
"Complete": "Completo",
"On Hold": "En espera",
"Declined": "Rechazado",
"Cancelled": "Cancelado",
"Open": "Abierto",
"Pending": "Pendiente",
"Approved": "Aprobado",
"Paid": "Pagado",
"New": "Nuevo",
"Scheduled": "Programado",
"Closed": "Cerrado",
"Needs Info": "Necesita información",
"Invoiced — Pending Info": "Facturado — falta información",
"Loading work orders…": "Cargando órdenes de trabajo…",
"Loading…": "Cargando…",
"No open work orders.": "No hay órdenes de trabajo abiertas.",
"Nothing complete and unbilled — you're all caught up.": "Nada completo sin facturar — está al día.",
"No invoiced jobs yet.": "Aún no hay trabajos facturados.",
"No work orders.": "No hay órdenes de trabajo.",
"Update ready — tap to refresh": "Actualización lista — toque para actualizar",
"ACCEPT TO UNLOCK": "ACEPTE PARA DESBLOQUEAR",
"Please accept this work order to view the lockbox code and tenant contact. Accepting also lets us notify the tenant that a technician is on the way.": "Acepte esta orden de trabajo para ver el código de la caja y el contacto del inquilino. Al aceptar, también podemos avisar al inquilino que un técnico va en camino.",
"Accept work order": "Aceptar orden de trabajo",
"Decline": "Rechazar",
"Address": "Dirección",
"Room / Area": "Cuarto / Área",
"Issue": "Problema",
"Tenant": "Inquilino",
"Owner Ref #": "Ref. del dueño #",
"Notes": "Notas",
"Accept work order to view": "Acepte la orden de trabajo para ver",
"None on file": "Ninguno registrado",
"MASTER KEY REQUIRED": "SE REQUIERE LLAVE MAESTRA",
"ACCESS INSTRUCTIONS": "INSTRUCCIONES DE ACCESO",
"ACCESS KEYS": "LLAVES DE ACCESO",
"NO PROPERTY ACCESS NEEDED": "NO SE NECESITA ACCESO A LA PROPIEDAD",
"Access codes are not shared for this work order.": "Los códigos de acceso no se comparten para esta orden de trabajo.",
"PHOTOS": "FOTOS",
"PHOTOS & FILES": "FOTOS Y ARCHIVOS",
"BEFORE": "ANTES",
"AFTER": "DESPUÉS",
"None yet": "Ninguna todavía",
"REPORT ISSUE": "REPORTAR PROBLEMA",
"ESTIMATE": "ESTIMADO",
"Approved — no deposit required for this job. You're cleared to proceed.": "Aprobado — no se requiere depósito para este trabajo. Puede proceder.",
"Contact Ridge Co to request changes to an approved estimate.": "Comuníquese con Ridge Co para solicitar cambios a un estimado aprobado.",
"UPDATE STATUS": "ACTUALIZAR ESTADO",
"SAVE STATUS": "GUARDAR ESTADO",
"Pending review": "En espera de revisión",
"Reviewed by Ridge Co": "Revisado por Ridge Co",
"MY TIME": "MI TIEMPO",
"No time logged yet.": "Aún no hay tiempo registrado.",
"WHAT DID YOU DO?": "¿QUÉ HIZO?",
"the owner will see this": "el dueño verá esto",
"NOTES": "NOTAS",
"private, just for the office": "privado, solo para la oficina",
"Log Time": "Registrar tiempo",
"RIDGE CO CARD": "TARJETA DE RIDGE CO",
"Attach Photo": "Adjuntar foto",
"Who paid for this? (applies to the entry you add below)": "¿Quién pagó esto? (aplica a la entrada que agregue abajo)",
"Ridge Co card": "Tarjeta de Ridge Co",
"My own money": "Mi propio dinero",
"Schedule": "Programar",
"Add notes (optional)…": "Agregar notas (opcional)…",
"Voice to text": "Voz a texto",
"Start": "Inicio",
"End": "Fin",
"Describe what was done in as much detail as possible": "Describa lo que se hizo con el mayor detalle posible",
"Picked up materials, took measurements…": "Recogí materiales, tomé medidas…",
"Amount $": "Monto $",
"Store / supplier": "Tienda / proveedor",
"Description: what was purchased": "Descripción: qué se compró",
"Labor": "Mano de obra",
"Travel": "Viaje",
"Materials Run": "Compra de materiales",
"Measurement / Quote": "Medición / Cotización",
"Other": "Otro",
"Needs Your Attention": "Necesita su atención",
"Upload photos": "Subir fotos",
"Update / clarify your description": "Actualice / aclare su descripción",
"Mark Done": "Marcar como hecho",
"While You're Here": "Mientras está allí",
"REPORT ISSUE / REQUEST FEATURE": "REPORTAR PROBLEMA / SOLICITAR FUNCIÓN",
"Your feedback goes directly to the admin team. Include as much detail as you can.": "Sus comentarios van directamente al equipo administrativo. Incluya todos los detalles que pueda.",
"Cancel": "Cancelar",
"SEND": "ENVIAR",
"Describe the issue or request…": "Describa el problema o la solicitud…",
"Bug / Something broken": "Error / Algo no funciona",
"Feature request": "Solicitud de función",
"Other feedback": "Otros comentarios",
"MY CONTACT INFO": "MIS DATOS DE CONTACTO",
"Keep your phone and email current so job updates and invoice confirmations reach you. To correct your name, contact Ridge Co directly.": "Mantenga su teléfono y correo al día para recibir actualizaciones de trabajos y confirmaciones de facturas. Para corregir su nombre, comuníquese directamente con Ridge Co.",
"Phone": "Teléfono",
"Email": "Correo electrónico",
"Company (optional)": "Empresa (opcional)",
"SAVE": "GUARDAR",
"you@example.com": "usted@ejemplo.com",
"SCHEDULE / DISPATCH": "PROGRAMAR / DESPACHO",
"DATE": "FECHA",
"Today": "Hoy",
"TIME WINDOW": "HORARIO",
"Notify tenant by SMS": "Avisar al inquilino por SMS",
"SAVE SCHEDULE": "GUARDAR HORARIO",
"Select time window": "Seleccione un horario",
"Within 1 hour — sends immediate tenant SMS": "En 1 hora — envía un SMS inmediato al inquilino",
"Within 1 hour": "En 1 hora",
"selected — tenant SMS will be sent immediately on save.": "seleccionado — se enviará un SMS al inquilino al guardar.",
"All Day": "Todo el día",
"Custom — enter time below": "Personalizado — ingrese la hora abajo",
"CUSTOM TIME": "HORA PERSONALIZADA",
"By the Hour": "Por hora",
"Flat Price": "Precio fijo",
"LABOR": "MANO DE OBRA",
"Hours worked": "Horas trabajadas",
"Rate/hr": "Tarifa/hora",
"Labor total": "Total de mano de obra",
"Rate not set": "Tarifa no definida",
"TRUCK STOCK USED": "MATERIAL DE LA CAMIONETA USADO",
"Used truck stock": "Usé material de la camioneta",
"estimated value": "valor estimado",
"YOUR INVOICE FILE (optional)": "SU ARCHIVO DE FACTURA (opcional)",
"Upload Invoice": "Subir factura",
"A photo or PDF of your invoice, if you have one — we'll try to read the amount, invoice #, and date for you.": "Una foto o PDF de su factura, si la tiene — intentaremos leer el monto, el número y la fecha por usted.",
"YOUR INVOICE NUMBER (optional)": "NÚMERO DE SU FACTURA (opcional)",
"If you have one — otherwise we use the job number": "Si tiene uno — si no, usamos el número del trabajo",
"This is what we'll reference when we pay you.": "Esto es lo que usaremos como referencia cuando le paguemos.",
"YOUR INVOICE DATE (optional)": "FECHA DE SU FACTURA (opcional)",
"NOTES (optional)": "NOTAS (opcional)",
"Any extra info about materials, access issues, why it ran long…": "Información adicional sobre materiales, problemas de acceso, por qué tomó más tiempo…",
"Enter hours or items above": "Ingrese horas o artículos arriba",
"TOTAL": "TOTAL",
"Total": "Total",
"Confirm & Submit": "Confirmar y enviar",
"Reading invoice…": "Leyendo factura…",
"Couldn’t read that one — just fill it in below": "No pudimos leer esa — llénela abajo",
"attaching file…": "adjuntando archivo…",
"file attached": "archivo adjunto",
"Invoice photo attached": "Foto de factura adjunta",
"No invoice photo attached": "Sin foto de factura adjunta",
"Unknown store": "Tienda desconocida",
"Use this to bill for something you did that": "Use esto para cobrar algo que hizo que",
"isn't": "no está",
"tied to a specific Work Order, like tenant treats or a small extra at one of your properties. If a Work Order already exists for the job, submit your invoice from that Work Order instead — this is only for work that never had one.": "vinculado a una orden de trabajo específica, como golosinas para inquilinos o un pequeño extra en una de sus propiedades. Si ya existe una orden de trabajo para el trabajo, envíe su factura desde esa orden de trabajo — esto es solo para trabajo que nunca tuvo una.",
"Upload Receipt": "Subir recibo de compra",
"Who paid for this? — REQUIRED": "¿Quién pagó esto? — REQUERIDO",
"I paid, reimburse me": "Yo pagué, reembólseme",
"Charged to Brett's/company card": "Cargado a la tarjeta de Brett/la empresa",
"Property owner": "Dueño de la propiedad",
"Ridge Co's own cost": "Costo propio de Ridge Co",
"What was this for? (e.g. tenant treats)": "¿Para qué fue esto? (p. ej., golosinas para inquilinos)",
"No properties on your billing list yet — request access below": "Aún no tiene propiedades en su lista de facturación — solicite acceso abajo",
"REQUEST PROPERTY ACCESS": "SOLICITAR ACCESO A PROPIEDAD",
"PROPERTY": "PROPIEDAD",
"NOTE (optional)": "NOTA (opcional)",
"NOTE": "NOTA",
"Close": "Cerrar",
"LOG A ONE-OFF JOB": "REGISTRAR UN TRABAJO ÚNICO",
"Use this only when you're doing a job today that hasn't been entered as a Work Order yet — like a quick call where Brett said \"go do X.\"": "Use esto solo cuando esté haciendo hoy un trabajo que aún no se ha ingresado como orden de trabajo — como una llamada rápida en la que Brett dijo \"vaya a hacer X.\"",
"This is not a substitute for regular Work Orders": "Esto no sustituye las órdenes de trabajo normales",
", and it shouldn't become your normal way of getting jobs. If you're getting jobs verbally on a regular basis, talk to Brett — he can set up a recurring job or a different process so this stays the exception, not the rule.": ", y no debe convertirse en su forma normal de recibir trabajos. Si recibe trabajos de forma verbal con regularidad, hable con Brett — él puede configurar un trabajo recurrente u otro proceso para que esto siga siendo la excepción, no la regla.",
"Owner requested it — the property owner asked for this directly": "El dueño lo pidió — el dueño de la propiedad lo solicitó directamente",
"Brett requested it — he called/texted before you entered this": "Brett lo pidió — llamó o escribió antes de que usted lo ingresara",
"Other — explain below (required)": "Otro — explique abajo (requerido)",
"(required for \"Other\")": "(requerido para \"Otro\")",
"e.g. owner Jennifer called me directly 9/24": "p. ej., la dueña Jennifer me llamó directamente el 24/9",
"billing@yourcompany.com": "facturacion@suempresa.com",
"123 Main St, City, ST 21201": "123 Calle Principal, Ciudad, ST 21201",
"Session expired - please sign in again": "Sesión vencida — inicie sesión de nuevo",
"Error submitting": "Error al enviar",
"Error sending request": "Error al enviar la solicitud",
"Upload failed": "Falló la carga",
"Estimate saved": "Estimado guardado",
"Failed to save": "No se pudo guardar",
"Time logged": "Tiempo registrado",
"Delete this time entry?": "¿Eliminar esta entrada de tiempo?",
"✓ Accepted — unlocking details…": "✓ Aceptado — desbloqueando detalles…",
"Connection error": "Error de conexión",
"Uploading photo…": "Subiendo foto…",
"Photo uploaded": "Foto subida",
"Unknown Property": "Propiedad desconocida",
"Add at least one line item": "Agregue al menos un artículo",
"Reason for change is required when revising": "Se requiere el motivo del cambio al revisar",
"Already saved — no duplicate created": "Ya guardado — no se creó un duplicado",
"Already logged — no duplicate created": "Ya registrado — no se creó un duplicado",
"Could not save": "No se pudo guardar",
"Connection dropped": "Se perdió la conexión",
"Optional — a quick reason helps us reassign fast:": "Opcional — un motivo breve nos ayuda a reasignar rápido:",
"Not applicable": "No aplica",
"Save for separate work order": "Guardar para una orden de trabajo aparte",
"Needs an estimate first": "Necesita un estimado primero",
"Couldn't access / blocked": "No pude entrar / bloqueado",
"Needs parts / materials": "Necesita partes / materiales",
"Report Issue": "Reportar problema",
"Session failed": "Falló la sesión",
"No changes to save": "No hay cambios para guardar",
"Yes": "Sí",
"No": "No",
"Final review — check this before submitting": "Revisión final — verifique esto antes de enviar",
"← Back, let me edit": "← Regresar, déjeme editar",
"Who paid for this? — REQUIRED, please check": "¿Quién pagó esto? — REQUERIDO, por favor marque",
"What was purchased (e.g. 4 outlets HD)": "Qué se compró (p. ej., 4 tomacorrientes HD)",
"Select a time window.": "Seleccione un horario.",
"Enter at least one billable item.": "Ingrese al menos un artículo facturable.",
"Checking your photo for receipts we might be missing…": "Revisando su foto por si falta algún recibo de compra…",
"Add each one as a Receipt row (with the amount and who paid) — this bill can't be submitted until they're all accounted for.": "Agregue cada uno como una fila de recibo de compra (con el monto y quién pagó) — esta factura no se puede enviar hasta que todos estén incluidos.",
"✓ Checked your photo — everything in it is accounted for below.": "✓ Revisamos su foto — todo lo que aparece está incluido abajo.",
"Couldn't auto-check your photo — please double check yourself that every receipt in it is entered below.": "No pudimos revisar su foto automáticamente — verifique usted mismo que cada recibo de compra esté ingresado abajo.",
"⚠ Your invoice photo shows receipts that aren't entered yet — add them above before submitting (see the warning by the photo upload).": "⚠ La foto de su factura muestra recibos de compra que aún no están ingresados — agréguelos arriba antes de enviar (vea la advertencia junto a la carga de la foto).",
"Description (any length)": "Descripción (cualquier longitud)",
"Reason for change (required if revising)…": "Motivo del cambio (requerido si revisa)…",
"Saving…": "Guardando…",
"✓ Approved — deposit is being requested from the customer. You'll be notified to proceed once received.": "✓ Aprobado — se está solicitando el depósito al cliente. Le avisaremos para que proceda cuando lo recibamos.",
"Could not load estimate": "No se pudo cargar el estimado",
"No estimate submitted yet.": "Aún no se ha enviado un estimado.",
"Ridge Co is not moving forward with this estimate. Thank you for sending it.": "Ridge Co no continuará con este estimado. Gracias por enviarlo.",
"View WO": "Ver orden",
"You have other open WOs nearby in the same area:": "Tiene otras órdenes de trabajo abiertas cerca, en la misma zona:",
"✎ Revise Estimate": "✎ Revisar estimado",
"Ridge Co needs a bit more information on this estimate. Please revise it below or call us.": "Ridge Co necesita un poco más de información sobre este estimado. Revíselo abajo o llámenos.",
"WHILE YOU'RE HERE": "MIENTRAS ESTÁ ALLÍ",
"Complete your info": "Complete su información",
"no work orders": "no hay órdenes de trabajo",
"Error logging job": "Error al registrar el trabajo",
"Flat rate": "Precio fijo",
"who paid": "quién pagó",
"Truck stock": "Material de la camioneta",
"file didn’t attach — tap Upload Invoice to retry": "el archivo no se adjuntó — toque Subir factura para reintentar",
"Delete this receipt?": "¿Eliminar este recibo de compra?",
"Delete": "Eliminar",
"Remove": "Quitar",
"Retry": "Reintentar",
"Back": "Atrás",
"Next": "Siguiente",
"Done": "Listo",
"OK": "OK",
"Submit": "Enviar",
"Total labor": "Total de mano de obra",
"Tarifa/hr": "Tarifa/hora",
"e.g. 2 caulk tubes, electrical tape, wire nuts": "p. ej., 2 tubos de sellador, cinta eléctrica, conectores de cable"
};
var ES_RULES = [
  [/^(\d+) work orders?$/, function(m){ return m[1] + (m[1] === '1' ? ' orden de trabajo' : ' órdenes de trabajo'); }],
  [/^VERSION (\d+)$/, function(m){ return 'VERSIÓN ' + m[1]; }],
  [/^(Morning|Afternoon|Evening) \((.+)\)$/, function(m){ return ({Morning:'Mañana',Afternoon:'Tarde',Evening:'Noche'})[m[1]] + ' (' + m[2] + ')'; }],
  [/^You already submitted an invoice for this job — (\$[\d.,]+)\. This form is pre-filled from it; submitting again updates it rather than creating a second one\.$/, function(m){ return 'Ya envió una factura para este trabajo — ' + m[1] + '. Este formulario está prellenado con ella; si envía de nuevo, se actualiza en lugar de crear una segunda.'; }],
  [/^✓ Status updated to (.+)$/, function(m){ return '✓ Estado actualizado a ' + esT(m[1]); }],
  [/^(\d+(?:\.\d+)?) hrs × \$([\d.,]+)\/hr = (\$[\d.,]+)$/, function(m){ return m[1] + ' h × $' + m[2] + '/h = ' + m[3]; }],
  [/^Flat rate: (\$[\d.,]+)$/, function(m){ return 'Precio fijo: ' + m[1]; }],
  [/^Truck stock(.*): (\$[\d.,]+)$/, function(m){ return 'Material de la camioneta' + m[1] + ': ' + m[2]; }],
  [/^(\d+) receipt\(s\) entered(?:, truck stock (\$[\d.,]+))?$/, function(m){ return m[1] + ' recibo(s) de compra ingresado(s)' + (m[2] ? ', material de la camioneta ' + m[2] : ''); }],
  [/^⚠ Your photo shows (\d+) receipt\(s\) not entered above:$/, function(m){ return '⚠ Su foto muestra ' + m[1] + ' recibo(s) de compra no ingresado(s) arriba:'; }],
  [/^• (.+?) — (\$[\d.,]+|amount unclear)(.*)$/, function(m){ return '• ' + esT(m[1]) + ' — ' + (m[2] === 'amount unclear' ? 'monto no claro' : m[2]) + m[3]; }],
  [/^✓ Invoice photo attached — checked, nothing missing$/, function(){ return '✓ Foto de factura adjunta — revisada, no falta nada'; }],
  [/^Approved by (.+)$/, function(m){ return 'Aprobado por ' + m[1]; }],
  [/^Reason: (.+)$/, function(m){ return 'Motivo: ' + m[1]; }],
  [/^▾ View (\d+) prior versions?$/, function(m){ return '▾ Ver ' + m[1] + (m[1] === '1' ? ' versión anterior' : ' versiones anteriores'); }],
  [/^Upload failed: (.+)$/, function(m){ return 'Falló la carga: ' + m[1]; }]
];
var _esLower = null;
function _esDict() {
  if (_esLower) return _esLower;
  _esLower = {};
  [ES, ES_EXTRA].forEach(function(d){ for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) _esLower[k.replace(/[‘’]/g, "'").toLowerCase()] = d[k]; } });
  return _esLower;
}
function _esCase(src, out) {          // keep the source's case style: urgent→urgente, URGENT→URGENTE
  if (src === src.toLowerCase() && src !== src.toUpperCase()) return out.toLowerCase();
  if (src === src.toUpperCase() && /[A-Z]/.test(src)) return out.toUpperCase();
  return out;
}
function esT(s) {
  if (LANG !== 'es' || !s) return s;
  var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), lead = m[1], core = m[2], tail = m[3];
  if (!core || !/[A-Za-z]{2}/.test(core)) return s;
  var d = _esDict();
  function look(c) {
    c = c.replace(/[‘’]/g, "'");          // curly → straight apostrophes
    var hit = d[c.toLowerCase()];
    if (hit !== undefined) return _esCase(c, hit);
    for (var i = 0; i < ES_RULES.length; i++) { var r = ES_RULES[i][0].exec(c); if (r) return ES_RULES[i][1](r); }
    return null;
  }
  var out = look(core);
  if (out === null) {                       // peel leading emoji/symbols and trailing punctuation, retry
    var p = /^([^A-Za-z0-9¿¡]*)([\s\S]*?)([\s:…*.✓✔—–-]*)$/.exec(core);
    if (p && p[2]) {
      var oA = look(p[2] + p[3]);                       // keeps a trailing period/colon if the key has one
      if (oA !== null) out = p[1] + oA;
      else { var o2 = look(p[2]); if (o2 !== null) out = p[1] + o2 + p[3]; }
    }
  }
  return out === null ? s : lead + out + tail;
}
function esTranslateTree(root) {
  if (LANG !== 'es' || !root) return;
  var skip = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1 };
  function attrs(el) {
    ['placeholder', 'title', 'aria-label'].forEach(function(a){
      var v = el.getAttribute && el.getAttribute(a); if (v) { var n = esT(v); if (n !== v) el.setAttribute(a, n); }
    });
  }
  function walk(n) {
    if (n.nodeType === 3) { var t = n.nodeValue, r = esT(t); if (r !== t) n.nodeValue = r; return; }
    if (n.nodeType !== 1 || n.hasAttribute('data-notranslate')) return;
    attrs(n);                       // placeholders live on TEXTAREA/INPUT too, so do this before the skip
    if (skip[n.tagName]) return;
    for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
  }
  walk(root);
}
var _esObs = null;
function esStartObserver() {
  if (_esObs || LANG !== 'es' || typeof MutationObserver === 'undefined') return;
  document.documentElement.lang = 'es';
  var busy = false;
  _esObs = new MutationObserver(function(muts) {
    if (busy) return; busy = true;
    try {
      muts.forEach(function(m) {
        if (m.type === 'characterData') { var t = m.target.nodeValue, r = esT(t); if (r !== t) m.target.nodeValue = r; }
        else if (m.type === 'attributes') { var v = m.target.getAttribute(m.attributeName), n = esT(v); if (v && n !== v) m.target.setAttribute(m.attributeName, n); }
        else m.addedNodes.forEach(function(n){ esTranslateTree(n); });
      });
    } finally { busy = false; }
  });
  _esObs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] });
}
(function(){   // alert / confirm / prompt text is not in the DOM, so translate it at the call
  var a = window.alert, c = window.confirm, p = window.prompt;
  window.alert = function(m){ return a.call(window, esT(String(m))); };
  window.confirm = function(m){ return c.call(window, esT(String(m))); };
  window.prompt = function(m, d){ return p.call(window, esT(String(m)), d); };
})();
