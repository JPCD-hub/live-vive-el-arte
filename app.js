const STORAGE_KEY = 'live-vive-el-arte-v1';
const BENEFIT_VISITS = 5;
let scanner = null;
let displayedTicket = null;

const state = loadState();
const $ = (selector) => document.querySelector(selector);

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.people) && Array.isArray(saved.events) && Array.isArray(saved.checkins)) { saved.benefits ??= []; return saved; }
  } catch (_) { /* Use a clean database when saved content is invalid. */ }
  return { people: [], events: [{ id: createId(), name: 'Vive el Arte', date: localDate(), description: 'Encuentro semanal de la comunidad.' }], checkins: [], benefits: [] };
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function createId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function localDate() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(value = '') { const node = document.createElement('div'); node.textContent = value; return node.innerHTML; }
function countVisits(personId) { return state.checkins.filter((item) => item.personId === personId).length; }
function isCourtesy(person) { return person.ticketType === 'courtesy'; }
function ticketLabel(person) { return isCourtesy(person) ? 'Cortesía' : 'Regular'; }
function formatDate(value) { return new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(new Date(`${value}T12:00:00`)); }
function currentEvent() { return state.events.find((event) => event.id === $('#active-event').value) || state.events[0]; }
function availableBenefit(personId) { return state.benefits.find((benefit) => benefit.personId === personId && !benefit.usedAt); }
function grantPendingBenefits() {
  let changed = false;
  state.people.filter((person) => !isCourtesy(person)).forEach((person) => {
    const earned = Math.floor(countVisits(person.id) / BENEFIT_VISITS);
    const issued = state.benefits.filter((benefit) => benefit.personId === person.id).length;
    for (let index = issued; index < earned; index += 1) {
      const qualifyingCheckin = state.checkins.filter((checkin) => checkin.personId === person.id)[((index + 1) * BENEFIT_VISITS) - 1];
      const qualifyingEvent = state.events.find((event) => event.id === qualifyingCheckin?.eventId);
      const nextEvent = state.events.filter((event) => event.date > (qualifyingEvent?.date || localDate())).sort((a, b) => a.date.localeCompare(b.date))[0];
      if (!nextEvent) break;
      state.benefits.push({ id: createId(), personId: person.id, eventId: nextEvent.id, eventName: nextEvent.name, earnedAt: new Date().toISOString(), usedAt: null });
      changed = true;
    }
  });
  return changed;
}

function render() {
  renderStats(); renderPeople(); renderEvents(); renderSelects();
}
function renderStats() {
  const benefitPeople = state.benefits.filter((benefit) => !benefit.usedAt).length;
  $('#total-people').textContent = state.people.length;
  $('#total-events').textContent = state.events.length;
  $('#total-benefits').textContent = benefitPeople;
}
function renderPeople() {
  const search = $('#person-search').value.trim().toLowerCase();
  const people = state.people.filter((person) => `${person.name} ${person.email} ${person.phone}`.toLowerCase().includes(search));
  $('#people-count').textContent = `${people.length} ${people.length === 1 ? 'persona' : 'personas'}`;
  $('#empty-people').hidden = state.people.length !== 0;
  $('#people-list').innerHTML = people.map((person) => {
    const contact = [person.email, person.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto';
    const visits = countVisits(person.id);
    const requiredVisits = isCourtesy(person) ? 3 : BENEFIT_VISITS;
    return `<article class="person-row"><div class="person-main"><p class="person-name">${escapeHtml(person.name)} <span class="ticket-type ${isCourtesy(person) ? 'courtesy' : ''}">${ticketLabel(person)}</span></p><p class="person-detail">${escapeHtml(contact)}</p></div><div class="attendance"><b>${visits}</b> / ${requiredVisits} visitas</div><div class="row-actions"><button class="small-button" data-ticket="${person.id}">Ver boleta</button><button class="small-button delete" data-delete-person="${person.id}">Eliminar</button></div></article>`;
  }).join('');
}
function renderEvents() {
  $('#event-list').innerHTML = state.events.slice().sort((a, b) => b.date.localeCompare(a.date)).map((event) => {
    const attendances = state.checkins.filter((item) => item.eventId === event.id).length;
    return `<article class="event-card"><button class="small-button delete event-delete" data-delete-event="${event.id}">Eliminar</button><span class="event-date">${formatDate(event.date)}</span><h3>${escapeHtml(event.name)}</h3><p>${escapeHtml(event.description || 'Sin descripcion.')}</p><span class="event-attendance">${attendances} ingresos</span></article>`;
  }).join('');
}
function renderSelects() {
  const selectedEvent = $('#active-event').value;
  $('#active-event').innerHTML = state.events.map((event) => `<option value="${event.id}">${escapeHtml(event.name)} · ${formatDate(event.date)}</option>`).join('');
  $('#active-event').value = state.events.some((event) => event.id === selectedEvent) ? selectedEvent : (state.events[0]?.id || '');
  const selectedPerson = $('#manual-person').value;
  $('#manual-person').innerHTML = '<option value="">Selecciona una persona</option>' + state.people.slice().sort((a, b) => a.name.localeCompare(b.name)).map((person) => `<option value="${person.id}">${escapeHtml(person.name)} (${countVisits(person.id)} visitas)</option>`).join('');
  $('#manual-person').value = state.people.some((person) => person.id === selectedPerson) ? selectedPerson : '';
  $('#manual-checkin').disabled = !state.people.length || !state.events.length;
  $('#start-scanner').disabled = !state.people.length || !state.events.length;
}

function showTicket(personId) {
  const person = state.people.find((item) => item.id === personId);
  if (!person) return;
  showTicketData(person, countVisits(person.id));
}
function showTicketData(person, visits, sharedBenefit = null) {
  const reward = isCourtesy(person) ? null : (sharedBenefit || availableBenefit(person.id));
  displayedTicket = { id: person.id, name: person.name, ticketType: isCourtesy(person) ? 'courtesy' : 'regular', visits, reward };
  const courtesy = isCourtesy(person);
  const requiredVisits = courtesy ? 3 : BENEFIT_VISITS;
  const completed = Math.min(visits, requiredVisits);
  const statusStamps = Array.from({ length: requiredVisits }, (_, index) => `<span class="reference-stamp reference-stamp-${index + 1} ${index < completed ? 'active' : ''}" aria-label="Visita ${index + 1}${index < completed ? ' registrada' : ' pendiente'}"></span>`).join('');
  const benefit = '';
  const image = courtesy ? 'boleta%201.jpeg' : 'Boleta%202.jpeg';
  const description = courtesy ? `Entrada de cortesía: ${visits} de 3 miércoles utilizados.` : (reward ? `Beneficio disponible para ${escapeHtml(reward.eventName)}. Usa el QR rojo en el próximo evento.` : `${visits} ${visits === 1 ? 'asistencia registrada' : 'asistencias registradas'} · Completa ${BENEFIT_VISITS} para recibir el QR del siguiente evento.`);
  const rewardMarkup = reward ? `<div class="ticket-qr-item reward-qr"><span>BENEFICIO · ${escapeHtml(reward.eventName)}</span><div id="benefit-qr" class="qr" aria-label="QR de beneficio para ${escapeHtml(reward.eventName)}"></div></div>` : '';
  $('#ticket-content').innerHTML = `<article class="ticket ticket-reference ${courtesy ? 'ticket-courtesy' : 'ticket-regular'}"><div class="ticket-art"><img src="${image}" alt="Boleta ${ticketLabel(person)} Vive el Arte" />${statusStamps}${benefit}</div><section class="ticket-personal"><div><p class="ticket-label">BOLETA VIRTUAL · ${ticketLabel(person).toUpperCase()}</p><p class="ticket-person">${escapeHtml(person.name)}</p><span class="ticket-code">CODIGO DE COMUNIDAD: ${person.id.slice(0, 8).toUpperCase()}</span><p class="ticket-visits">${description}</p></div><div class="ticket-codes"><div class="ticket-qr-item"><span>INGRESO</span><div id="ticket-qr" class="qr" aria-label="Codigo QR de ${escapeHtml(person.name)}"></div></div>${rewardMarkup}</div></section></article>`;
  const payload = JSON.stringify({ app: 'live-vive-el-arte', personId: person.id });
  new QRCode($('#ticket-qr'), { text: payload, width: 116, height: 116, colorDark: '#003c2d', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  if (reward) new QRCode($('#benefit-qr'), { text: JSON.stringify({ app: 'live-vive-el-arte', type: 'benefit', benefitId: reward.id, personId: person.id, eventId: reward.eventId }), width: 116, height: 116, colorDark: '#003c2d', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  if (!$('#ticket-modal').open) $('#ticket-modal').showModal();
}
function shareTicket() {
  if (!displayedTicket) return;
  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    alert('Publica primero la pagina en GitHub Pages para que la persona pueda abrir su boleta desde WhatsApp.');
    return;
  }
  const link = new URL(window.location.href);
  link.searchParams.set('boleta', JSON.stringify(displayedTicket));
  const type = displayedTicket.ticketType === 'courtesy' ? 'de cortesía' : 'regular';
  const message = `Hola ${displayedTicket.name}. Esta es tu boleta ${type} de Live! Vive el Arte. Muestra este QR al llegar al evento:\n${link.toString()}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
}
function openSharedTicket() {
  const source = new URLSearchParams(window.location.search).get('boleta');
  if (!source) return;
  try {
    const ticket = JSON.parse(source);
    if (!ticket.id || !ticket.name || !Number.isInteger(ticket.visits)) throw new Error();
    showTicketData({ id: ticket.id, name: ticket.name, ticketType: ticket.ticketType }, ticket.visits, ticket.reward);
  } catch (_) { /* Ignore invalid shared ticket links. */ }
}
function setFeedback(message, error = false) { const feedback = $('#checkin-feedback'); feedback.textContent = message; feedback.classList.toggle('error', error); }
function registerCheckin(personId) {
  const person = state.people.find((item) => item.id === personId);
  const event = currentEvent();
  if (!person || !event) return setFeedback('Selecciona una persona y un evento.', true);
  if (state.checkins.some((item) => item.personId === personId && item.eventId === event.id)) return setFeedback(`${person.name} ya tiene un ingreso registrado para este evento.`, true);
  if (isCourtesy(person) && countVisits(person.id) >= 3) return setFeedback(`La boleta de cortesía de ${person.name} ya utilizó sus 3 ingresos.`, true);
  state.checkins.push({ id: createId(), personId, eventId: event.id, checkedAt: new Date().toISOString() });
  grantPendingBenefits();
  saveState(); render(); setFeedback(`Ingreso registrado: ${person.name}. Ahora tiene ${countVisits(person.id)} visitas.`);
}
function redeemBenefit(benefitId) {
  const benefit = state.benefits.find((item) => item.id === benefitId);
  const event = currentEvent();
  if (!benefit || benefit.usedAt) return setFeedback('Este QR de beneficio ya fue utilizado o no es válido.', true);
  if (!event || benefit.eventId !== event.id) return setFeedback(`Este beneficio es válido para ${benefit.eventName}.`, true);
  const person = state.people.find((item) => item.id === benefit.personId);
  if (!person) return setFeedback('No se encontró la persona de este beneficio.', true);
  if (state.checkins.some((item) => item.personId === person.id && item.eventId === event.id)) return setFeedback(`${person.name} ya tiene un ingreso en este evento.`, true);
  state.checkins.push({ id: createId(), personId: person.id, eventId: event.id, type: 'benefit', checkedAt: new Date().toISOString() });
  benefit.usedAt = new Date().toISOString();
  grantPendingBenefits(); saveState(); render(); setFeedback(`Beneficio canjeado: ingreso registrado para ${person.name}.`);
}

function openModal(id) { $(`#${id}`).showModal(); }
document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => openModal(button.dataset.open)));
$('#person-search').addEventListener('input', renderPeople);
$('#people-list').addEventListener('click', (event) => {
  const ticketButton = event.target.closest('[data-ticket]'); const deleteButton = event.target.closest('[data-delete-person]');
  if (ticketButton) showTicket(ticketButton.dataset.ticket);
  if (deleteButton) {
    const person = state.people.find((item) => item.id === deleteButton.dataset.deletePerson);
    if (person && confirm(`Eliminar a ${person.name} y sus asistencias?`)) { state.people = state.people.filter((item) => item.id !== person.id); state.checkins = state.checkins.filter((item) => item.personId !== person.id); state.benefits = state.benefits.filter((item) => item.personId !== person.id); saveState(); render(); }
  }
});
$('#event-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete-event]'); if (!button) return;
  const selected = state.events.find((item) => item.id === button.dataset.deleteEvent);
  if (selected && confirm(`Eliminar el evento "${selected.name}"? Sus ingresos tambien se eliminaran.`)) { state.events = state.events.filter((item) => item.id !== selected.id); state.checkins = state.checkins.filter((item) => item.eventId !== selected.id); state.benefits = state.benefits.filter((item) => item.eventId !== selected.id); saveState(); render(); }
});
$('#new-person-form').addEventListener('submit', (event) => {
  event.preventDefault(); const form = event.currentTarget;
  if (event.submitter?.value === 'cancel') { $('#person-form').close(); return; }
  state.people.push({ id: createId(), name: $('#person-name').value.trim(), ticketType: $('#person-ticket-type').value, email: $('#person-email').value.trim(), phone: $('#person-phone').value.trim(), note: $('#person-note').value.trim(), createdAt: new Date().toISOString() });
  saveState(); form.reset(); $('#person-form').close(); render(); showTicket(state.people.at(-1).id);
});
$('#new-event-form').addEventListener('submit', (event) => {
  event.preventDefault(); const form = event.currentTarget;
  if (event.submitter?.value === 'cancel') { $('#event-form').close(); return; }
  state.events.push({ id: createId(), name: $('#event-name').value.trim(), date: $('#event-date').value, description: $('#event-description').value.trim() });
  grantPendingBenefits(); saveState(); form.reset(); $('#event-form').close(); render();
});
$('#manual-checkin').addEventListener('click', () => registerCheckin($('#manual-person').value));
$('#close-ticket').addEventListener('click', () => $('#ticket-modal').close());
$('#share-ticket').addEventListener('click', shareTicket);

async function startScanner() {
  if (!window.Html5Qrcode) return setFeedback('No se pudo cargar el lector QR. Revisa tu conexion.', true);
  $('#qr-reader').hidden = false; $('#start-scanner').hidden = true; $('#stop-scanner').hidden = false;
  scanner = new Html5Qrcode('qr-reader');
  try {
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 220, height: 220 } }, (decoded) => {
      try { const payload = JSON.parse(decoded); if (payload.app !== 'live-vive-el-arte') throw new Error(); if (payload.type === 'benefit') redeemBenefit(payload.benefitId); else registerCheckin(payload.personId); stopScanner(); } catch (_) { setFeedback('Este QR no pertenece a una boleta Live!', true); }
    });
  } catch (_) { setFeedback('No se pudo abrir la camara. Autoriza el permiso o registra el ingreso manualmente.', true); stopScanner(); }
}
async function stopScanner() {
  if (scanner) { try { await scanner.stop(); } catch (_) { /* Scanner was not started. */ } scanner.clear(); scanner = null; }
  $('#qr-reader').hidden = true; $('#start-scanner').hidden = false; $('#stop-scanner').hidden = true;
}
$('#start-scanner').addEventListener('click', startScanner); $('#stop-scanner').addEventListener('click', stopScanner);
$('#export-data').addEventListener('click', () => {
  const file = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }); const link = document.createElement('a');
  link.href = URL.createObjectURL(file); link.download = `live-respaldo-${localDate()}.json`; link.click(); URL.revokeObjectURL(link.href);
});
$('#import-data').addEventListener('change', (event) => {
  const [file] = event.target.files; if (!file) return;
  const reader = new FileReader(); reader.onload = () => { try { const imported = JSON.parse(reader.result); if (!Array.isArray(imported.people) || !Array.isArray(imported.events) || !Array.isArray(imported.checkins)) throw new Error(); state.people = imported.people; state.events = imported.events; state.checkins = imported.checkins; state.benefits = Array.isArray(imported.benefits) ? imported.benefits : []; grantPendingBenefits(); saveState(); render(); setFeedback('Datos importados correctamente.'); } catch (_) { alert('El archivo no tiene un formato de respaldo valido.'); } event.target.value = ''; }; reader.readAsText(file);
});

$('#event-date').value = localDate();
if (grantPendingBenefits()) saveState();
render();
openSharedTicket();
