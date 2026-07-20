import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBK9l6lVxoAfgiLmLmK2qJCIVwFc0xNfqI',
  authDomain: 'ticket-service-c2eac.firebaseapp.com',
  projectId: 'ticket-service-c2eac',
  storageBucket: 'ticket-service-c2eac.firebasestorage.app',
  messagingSenderId: '1089836979524',
  appId: '1:1089836979524:web:786436a0b9287267ca7311',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const BENEFIT_VISITS = 5;
const APP_NAME = 'live-vive-el-arte';
const state = { people: [], events: [], checkins: [], benefits: [], tickets: new Map() };
const $ = (selector) => document.querySelector(selector);
let scanner = null;
let displayedTicket = null;
let operationalUnsubscribers = [];
let isAdmin = false;
let ticketRenderNumber = 0;
let authIssue = '';
const pendingBenefitSync = new Set();
const pendingLegacyEventMigration = new Set();
const operationalSources = new Map();
const submittingForms = new WeakSet();
let entryInFlight = false;
let scannerStarting = false;
let scannerDecoding = false;
let offlineCacheAvailable = false;
let displayedPersonId = null;
const libraryPromises = new Map();

function localDate() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}
function escapeHtml(value = '') { const node = document.createElement('div'); node.textContent = value; return node.innerHTML; }
function formatDate(value) { return new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(new Date(`${value}T12:00:00`)); }
function isCourtesy(person) { return person.ticketType === 'courtesy'; }
function ticketLabel(ticket) { return ticket.ticketType === 'courtesy' ? 'Cortesía' : 'Regular'; }
function requiredVisits(ticket) { return ticket.ticketType === 'courtesy' ? 3 : BENEFIT_VISITS; }
function cycleVisits(ticket) { return ticket.ticketType === 'courtesy' ? (Number(ticket.visits) || 0) : (Number(ticket.visits) || 0) % BENEFIT_VISITS; }
function ticketForPerson(person) { return state.tickets.get(person.ticketToken); }
function countVisits(person) { return ticketForPerson(person)?.visits ?? state.checkins.filter((checkin) => checkin.personId === person.id).length; }
function sortedEvents() { return state.events.slice().sort((a, b) => a.date.localeCompare(b.date)); }
function availableEvents(events = state.events) { return events.filter((event) => event.status === 'published'); }
function currentEvent() { return availableEvents().find((event) => event.id === $('#active-event').value); }
function nextEventAfter(event, events = state.events) { return availableEvents(events).slice().sort((a, b) => a.date.localeCompare(b.date)).find((candidate) => candidate.date > event.date); }
function setFeedback(message, error = false) {
  const feedback = $('#checkin-feedback');
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
}
function operationalDataIsCurrent() {
  return ['people', 'events', 'checkins', 'benefits', 'tickets'].every((name) => operationalSources.get(name) === true);
}
function canRegisterEntries(ignoreDecodeLock = false) {
  return navigator.onLine && operationalDataIsCurrent() && !entryInFlight && !scannerStarting && (ignoreDecodeLock || !scannerDecoding);
}
function updateEntryControls() {
  const event = currentEvent();
  const blocked = !canRegisterEntries();
  $('#active-event').disabled = Boolean(scanner || scannerStarting || entryInFlight) || !state.events.length;
  $('#manual-person').disabled = entryInFlight || !state.people.length;
  $('#manual-checkin').disabled = blocked || !event || !state.people.length;
  $('#start-scanner').disabled = blocked || !event;
}
function updateConnectionStatus() {
  const status = $('#connection-status');
  if (!status) return;
  status.className = 'connection-status';
  if (!navigator.onLine) {
    status.textContent = 'Sin conexión. No se pueden registrar ingresos.';
    status.classList.add('offline');
  } else if (!operationalDataIsCurrent()) {
    status.textContent = offlineCacheAvailable
      ? 'Sincronizando datos. Espera antes de registrar ingresos.'
      : 'Conectando datos operativos. Espera antes de registrar ingresos.';
    status.classList.add('offline');
  } else {
    status.textContent = 'Datos sincronizados. Puedes registrar ingresos.';
    status.classList.add('online');
  }
  updateEntryControls();
}
async function submitEntry(operation, ignoreDecodeLock = false) {
  if (entryInFlight) return;
  if (!canRegisterEntries(ignoreDecodeLock)) {
    setFeedback(navigator.onLine ? 'Espera a que los datos terminen de sincronizar.' : 'No hay conexión. No se puede registrar el ingreso.', true);
    updateConnectionStatus();
    return;
  }
  entryInFlight = true;
  updateEntryControls();
  try {
    await operation();
  } catch (error) {
    reportOperationError(error);
  } finally {
    entryInFlight = false;
    updateEntryControls();
  }
}
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function loadLibrary(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (libraryPromises.has(url)) return libraryPromises.get(url);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error(`${globalName} no se cargó.`));
    script.onerror = () => reject(new Error(`No se pudo cargar ${globalName}.`));
    document.head.append(script);
  });
  libraryPromises.set(url, promise);
  promise.catch(() => libraryPromises.delete(url));
  return promise;
}
async function loadScannerLibrary() {
  try {
    return await loadLibrary('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js', 'Html5Qrcode');
  } catch (_) {
    return loadLibrary('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js', 'Html5Qrcode');
  }
}
function ticketArtUrl(courtesy) { return new URL(courtesy ? 'boleta 1.jpeg' : 'Boleta 2.jpeg', import.meta.url).href; }
function ticketTokenFromValue(value) {
  const text = value.trim();
  if (/^[A-Za-z0-9_-]{43}$/.test(text)) return text;
  try {
    const url = new URL(text);
    const token = url.searchParams.get('boleta');
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  } catch (_) { return null; }
}
function payloadFromValue(value) {
  const token = ticketTokenFromValue(value);
  if (token) return { app: APP_NAME, ticketToken: token };
  try {
    const payload = JSON.parse(value);
    if (!payload || typeof payload !== 'object') userError('Pega un enlace de boleta, un token válido o el contenido completo del QR.');
    return payload;
  } catch (_) { userError('Pega un enlace de boleta, un token válido o el contenido completo del QR.'); }
}
function checkinRef(eventId, personId) { return doc(db, 'checkins', `${eventId}_${personId}`); }
function benefitRef(personId, visitNumber) { return doc(db, 'benefits', `${personId}_${visitNumber}`); }

class UserMessageError extends Error {}
function userError(message) { throw new UserMessageError(message); }
function requireAdmin() {
  if (!isAdmin) userError('Tu cuenta no tiene acceso de administración.');
}
function reportOperationError(error) {
  console.error(error);
  setFeedback(error instanceof UserMessageError ? error.message : 'No se pudo guardar el cambio. Revisa tu conexión y permisos.', true);
}
function authErrorMessage(error) {
  const messages = {
    'auth/email-already-in-use': 'Este correo ya tiene una cuenta. Usa Entrar.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  };
  return messages[error.code] || `No se pudo iniciar sesión (${error.code || 'error desconocido'}).`;
}
function cameraErrorMessage(error) {
  if (error instanceof UserMessageError) return error.message;
  const messages = {
    NotAllowedError: 'No se autorizó la cámara. Permítela desde el candado de la barra del navegador y vuelve a intentarlo.',
    NotFoundError: 'No se encontró una cámara. Conecta una cámara o usa el ingreso manual.',
    NotReadableError: 'La cámara está siendo usada por otra aplicación. Ciérrala e intenta de nuevo.',
    OverconstrainedError: 'La cámara seleccionada no está disponible. Elige otra cámara e intenta de nuevo.',
  };
  return messages[error?.name] || `No se pudo abrir la cámara. ${error?.message || 'Revisa el permiso y vuelve a intentarlo.'}`;
}

function updateAccessUi(user = auth.currentUser) {
  $('#admin-app').hidden = !isAdmin;
  $('#admin-nav').hidden = !isAdmin;
  $('#sign-in').hidden = Boolean(user);
  $('#sign-out').hidden = !user;
  $('#auth-status').textContent = isAdmin
    ? `Administrando como ${user.displayName || user.email}`
    : user
      ? `Esta cuenta aún no tiene acceso de administración. ID: ${user.uid}`
      : authIssue || 'Consulta tu boleta con su enlace personal.';
}

function stopOperationalListeners() {
  operationalUnsubscribers.forEach((unsubscribe) => unsubscribe());
  operationalUnsubscribers = [];
  operationalSources.clear();
  state.people = [];
  state.events = [];
  state.checkins = [];
  state.benefits = [];
  state.tickets = new Map();
  updateConnectionStatus();
}

function listenToOperationalData() {
  const listen = (name, apply) => onSnapshot(collection(db, name), { includeMetadataChanges: true }, (snapshot) => {
    operationalSources.set(name, !snapshot.metadata.fromCache);
    apply(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    render();
    updateConnectionStatus();
  }, (error) => {
    operationalSources.set(name, false);
    console.error(`No se pudo leer ${name}`, error);
    setFeedback('No se pudieron actualizar los datos operativos.', true);
    updateConnectionStatus();
  });
  operationalUnsubscribers = [
    listen('people', (items) => { state.people = items; }),
    listen('events', (items) => { state.events = items; }),
    listen('checkins', (items) => { state.checkins = items; }),
    listen('benefits', (items) => { state.benefits = items; }),
    listen('tickets', (items) => { state.tickets = new Map(items.map((item) => [item.id, item])); }),
  ];
}

function render() {
  if (!isAdmin) return;
  renderStats();
  renderPeople();
  renderEvents();
  renderSelects();
  syncPendingBenefitsToTickets();
  migrateLegacyEvents();
  updateConnectionStatus();
}
function migrateLegacyEvents() {
  state.events.filter((event) => !Object.prototype.hasOwnProperty.call(event, 'status') && !pendingLegacyEventMigration.has(event.id)).forEach((event) => {
    pendingLegacyEventMigration.add(event.id);
    runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(doc(db, 'events', event.id));
      if (snapshot.exists() && !Object.prototype.hasOwnProperty.call(snapshot.data(), 'status')) transaction.update(snapshot.ref, { status: 'published', updatedAt: serverTimestamp() });
    })
      .catch((error) => console.error('No se pudo publicar un evento heredado.', error))
      .finally(() => pendingLegacyEventMigration.delete(event.id));
  });
}
function syncPendingBenefitsToTickets() {
  state.benefits.filter((benefit) => !benefit.usedAt && benefit.token && benefit.ticketToken).forEach((benefit) => {
    const ticket = state.tickets.get(benefit.ticketToken);
    if (!ticket || (ticket.benefits || []).some((item) => item.token === benefit.token) || pendingBenefitSync.has(benefit.id)) return;
    pendingBenefitSync.add(benefit.id);
    runTransaction(db, async (transaction) => {
      const ticketSnapshot = await transaction.get(doc(db, 'tickets', benefit.ticketToken));
      if (!ticketSnapshot.exists()) return;
      const benefits = Array.isArray(ticketSnapshot.data().benefits) ? ticketSnapshot.data().benefits : [];
      if (!benefits.some((item) => item.token === benefit.token)) {
        transaction.update(ticketSnapshot.ref, { benefits: [...benefits, { token: benefit.token, eventName: benefit.eventName || 'Próximo evento' }] });
      }
    }).catch((error) => console.error('No se pudo sincronizar un beneficio pendiente.', error)).finally(() => pendingBenefitSync.delete(benefit.id));
  });
}
function renderStats() {
  $('#total-people').textContent = state.people.length;
  $('#total-events').textContent = state.events.length;
  $('#total-benefits').textContent = state.benefits.filter((benefit) => !benefit.usedAt).length;
}
function renderPeople() {
  const search = $('#person-search').value.trim().toLowerCase();
  const people = state.people.filter((person) => `${person.name} ${person.email} ${person.phone}`.toLowerCase().includes(search));
  $('#people-count').textContent = `${people.length} ${people.length === 1 ? 'persona' : 'personas'}`;
  $('#empty-people').hidden = state.people.length !== 0;
  $('#people-list').innerHTML = people.map((person) => {
    const contact = [person.email, person.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto';
    const visits = countVisits(person);
    const progress = isCourtesy(person) ? visits : visits % BENEFIT_VISITS;
    const label = isCourtesy(person) ? 'visitas' : 'ciclo';
    const upgrade = isCourtesy(person) && visits >= 3 ? `<button class="small-button upgrade" data-upgrade-person="${person.id}">Pasar a regular</button>` : '';
    return `<article class="person-row"><div class="person-main"><p class="person-name">${escapeHtml(person.name)} <span class="ticket-type ${isCourtesy(person) ? 'courtesy' : ''}">${ticketLabel(person)}</span></p><p class="person-detail">${escapeHtml(contact)}</p></div><div class="attendance"><b>${progress}</b> / ${isCourtesy(person) ? 3 : BENEFIT_VISITS} ${label}</div><div class="row-actions"><button class="small-button" data-ticket="${person.id}">Ver boleta</button><button class="small-button" data-edit-person="${person.id}">Editar</button><button class="small-button" data-regenerate-ticket="${person.id}">Regenerar enlace</button>${upgrade}<button class="small-button delete" data-delete-person="${person.id}">Eliminar</button></div></article>`;
  }).join('');
}
function renderEvents() {
  $('#event-list').innerHTML = sortedEvents().reverse().map((event) => {
    const attendances = state.checkins.filter((item) => item.eventId === event.id).length;
    const status = event.status === 'draft' ? 'Borrador' : event.status === 'cancelled' ? 'Cancelado' : 'Publicado';
    return `<article class="event-card"><button class="small-button delete event-delete" data-delete-event="${event.id}">Eliminar</button><button class="small-button event-edit" data-edit-event="${event.id}">Editar</button><span class="event-date">${formatDate(event.date)}${event.time ? ` · ${escapeHtml(event.time)}` : ''}</span><h3>${escapeHtml(event.name)}</h3><p>${escapeHtml(event.description || 'Sin descripción.')}</p><span class="event-status">${status}</span><span class="event-attendance">${attendances} ingresos</span></article>`;
  }).join('');
}
function renderSelects() {
  const events = availableEvents().slice().sort((a, b) => a.date.localeCompare(b.date));
  const selectedEvent = $('#active-event').value;
  $('#active-event').innerHTML = '<option value="">Selecciona el evento activo</option>' + events.map((event) => `<option value="${event.id}">${escapeHtml(event.name)} · ${formatDate(event.date)}</option>`).join('');
  $('#active-event').value = events.some((event) => event.id === selectedEvent) ? selectedEvent : '';
  const selectedPerson = $('#manual-person').value;
  $('#manual-person').innerHTML = '<option value="">Selecciona una persona</option>' + state.people.slice().sort((a, b) => a.name.localeCompare(b.name)).map((person) => `<option value="${person.id}">${escapeHtml(person.name)} (${countVisits(person)} visitas)</option>`).join('');
  $('#manual-person').value = state.people.some((person) => person.id === selectedPerson) ? selectedPerson : '';
  updateEntryControls();
}

function renderTicket(container, ticket) {
  const visits = Number(ticket.visits) || 0;
  const courtesy = ticket.ticketType === 'courtesy';
  const required = requiredVisits(ticket);
  const completed = Math.min(cycleVisits(ticket), required);
  const benefits = Array.isArray(ticket.benefits) ? ticket.benefits : [];
  const renderId = ++ticketRenderNumber;
  const statusStamps = Array.from({ length: required }, (_, index) => `<span class="reference-stamp reference-stamp-${index + 1} ${index < completed ? 'active' : ''}" aria-label="Visita ${index + 1}${index < completed ? ' registrada' : ' pendiente'}"></span>`).join('');
  const description = courtesy
    ? visits >= 3
      ? 'Las 3 cortesías ya fueron utilizadas. Esta boleta no admite más ingresos.'
      : `Entrada de cortesía: ${visits} de 3 miércoles utilizados.`
    : benefits.length
      ? `Tienes ${benefits.length} ${benefits.length === 1 ? 'beneficio disponible' : 'beneficios disponibles'} para usar en los eventos indicados.`
      : visits && visits % BENEFIT_VISITS === 0
        ? `Completaste ${visits} asistencias. Tu nuevo ciclo comienza en 0 de ${BENEFIT_VISITS}.`
        : `${cycleVisits(ticket)} de ${BENEFIT_VISITS} asistencias en el ciclo actual · ${visits} en total.`;
  const benefitMarkup = benefits.map((benefit, index) => `<div class="ticket-qr-item reward-qr"><span>BENEFICIO · ${escapeHtml(benefit.eventName)}</span><div id="benefit-qr-${renderId}-${index}" class="qr" aria-label="QR de beneficio para ${escapeHtml(benefit.eventName)}"></div></div>`).join('');
  const upgradeNote = courtesy && visits >= 3 ? '<p class="ticket-upgrade-note">¿Quieres seguir asistiendo? Solicita al equipo Live! tu nueva boleta regular.</p>' : '';
  container.innerHTML = `<article class="ticket ticket-reference ${courtesy ? 'ticket-courtesy' : 'ticket-regular'}"><div class="ticket-art"><img src="${ticketArtUrl(courtesy)}" alt="Boleta ${ticketLabel(ticket)} Vive el Arte" />${statusStamps}</div><section class="ticket-personal"><div><p class="ticket-label">BOLETA VIRTUAL · ${ticketLabel(ticket).toUpperCase()}</p><p class="ticket-person">${escapeHtml(ticket.name)}</p><span class="ticket-code">CÓDIGO DE COMUNIDAD: ${ticket.id.slice(0, 8).toUpperCase()}</span><p class="ticket-visits">${description}</p>${upgradeNote}</div><div class="ticket-codes"><div class="ticket-qr-item"><span>INGRESO</span><div id="ticket-qr-${renderId}" class="qr" aria-label="Código QR de ${escapeHtml(ticket.name)}"></div></div>${benefitMarkup}</div></section></article>`;
  loadLibrary('https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js', 'QRCode').then((QRCode) => {
    requestAnimationFrame(() => {
      const renderQr = (element, data) => {
        if (!element) return;
        const size = Math.max(70, Math.round(element.getBoundingClientRect().width));
        new QRCode(element, { text: JSON.stringify(data), width: size, height: size, colorDark: '#003c2d', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      };
      renderQr($(`#ticket-qr-${renderId}`), { app: APP_NAME, ticketToken: ticket.id });
      benefits.forEach((benefit, index) => renderQr($(`#benefit-qr-${renderId}-${index}`), { app: APP_NAME, type: 'benefit', benefitToken: benefit.token }));
    });
  }).catch((error) => {
    console.error(error);
    const entryQr = $(`#ticket-qr-${renderId}`);
    if (entryQr) entryQr.textContent = 'No se pudo cargar el QR.';
  });
}
function showTicket(personId) {
  const person = state.people.find((item) => item.id === personId);
  const ticket = person && ticketForPerson(person);
  if (!ticket) return setFeedback('La boleta todavía no está disponible.', true);
  displayedTicket = ticket;
  displayedPersonId = personId;
  renderTicket($('#ticket-content'), ticket);
  if (!$('#ticket-modal').open) $('#ticket-modal').showModal();
}
function shareTicket() {
  if (!displayedTicket) return;
  const link = new URL('./', import.meta.url);
  link.searchParams.set('boleta', displayedTicket.id);
  const type = displayedTicket.ticketType === 'courtesy' ? 'de cortesía' : 'regular';
  const message = `Hola ${displayedTicket.name}. Esta es tu boleta ${type} de Live! Vive el Arte. Muéstrala al llegar al evento:\n${link}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
}
async function copyTicketLink() {
  if (!displayedTicket) return;
  const link = new URL('./', import.meta.url);
  link.searchParams.set('boleta', displayedTicket.id);
  try {
    await navigator.clipboard.writeText(link.toString());
    setFeedback('Nuevo enlace copiado.', false);
  } catch (error) {
    console.error(error);
    setFeedback('No se pudo copiar el enlace. Ábrelo y cópialo desde el navegador.', true);
  }
}

async function createPerson(event) {
  requireAdmin();
  const form = event.currentTarget;
  const person = {
    name: $('#person-name').value.trim(),
    ticketType: $('#person-ticket-type').value,
    email: $('#person-email').value.trim(),
    phone: $('#person-phone').value.trim(),
    note: $('#person-note').value.trim(),
    createdAt: serverTimestamp(),
  };
  const personRef = doc(collection(db, 'people'));
  const ticketToken = randomToken();
  const batch = writeBatch(db);
  batch.set(personRef, { ...person, ticketToken });
  batch.set(doc(db, 'tickets', ticketToken), { name: person.name, ticketType: person.ticketType, visits: 0, benefits: [] });
  await batch.commit();
  form.reset();
  $('#person-form').close();
  displayedTicket = { id: ticketToken, name: person.name, ticketType: person.ticketType, visits: 0, benefits: [] };
  displayedPersonId = personRef.id;
  renderTicket($('#ticket-content'), displayedTicket);
  $('#ticket-modal').showModal();
}

function openPersonForm(personId) {
  const person = state.people.find((item) => item.id === personId);
  const form = $('#person-form');
  const editing = Boolean(person);
  $('#person-id').value = person?.id || '';
  $('#person-form-title').textContent = editing ? 'Editar persona' : 'Registrar persona';
  $('#person-submit').textContent = editing ? 'Guardar cambios' : 'Crear boleta';
  $('#person-name').value = person?.name || '';
  $('#person-ticket-type').value = person?.ticketType || 'regular';
  $('#person-ticket-type').disabled = editing;
  $('#person-email').value = person?.email || '';
  $('#person-phone').value = person?.phone || '';
  $('#person-note').value = person?.note || '';
  $('#person-form-feedback').textContent = '';
  form.showModal();
}

async function updatePerson(event) {
  requireAdmin();
  const form = event.currentTarget;
  const personId = $('#person-id').value;
  const existing = state.people.find((item) => item.id === personId);
  if (!existing) userError('No se encontró la persona para actualizar.');
  const updates = {
    name: $('#person-name').value.trim(),
    email: $('#person-email').value.trim(),
    phone: $('#person-phone').value.trim(),
    note: $('#person-note').value.trim(),
  };
  await runTransaction(db, async (transaction) => {
    const [personSnapshot, ticketSnapshot] = await Promise.all([
      transaction.get(doc(db, 'people', personId)),
      transaction.get(doc(db, 'tickets', existing.ticketToken)),
    ]);
    if (!personSnapshot.exists() || !ticketSnapshot.exists()) userError('No se encontró la boleta de esta persona.');
    transaction.update(personSnapshot.ref, updates);
    if (ticketSnapshot.data().name !== updates.name) transaction.update(ticketSnapshot.ref, { name: updates.name });
  });
  form.reset();
  $('#person-id').value = '';
  $('#person-ticket-type').disabled = false;
  $('#person-form').close();
  setFeedback(`Perfil actualizado: ${updates.name}.`);
}

async function addBenefit(transaction, person, ticket, event, visitNumber, events = state.events) {
  const nextEvent = nextEventAfter(event, events);
  const benefits = Array.isArray(ticket.benefits) ? ticket.benefits : [];
  const ref = benefitRef(person.id, visitNumber);
  const existingBenefit = await transaction.get(ref);
  if (existingBenefit.exists()) {
    const benefit = existingBenefit.data();
    const eventName = nextEvent?.name || benefit.eventName || 'Próximo evento';
    if (nextEvent && !benefit.eventId) transaction.update(ref, { eventId: nextEvent.id, eventName, pending: false });
    const publicBenefit = { token: benefit.token, eventName };
    return benefits.some((item) => item.token === benefit.token)
      ? benefits.map((item) => item.token === benefit.token ? publicBenefit : item)
      : [...benefits, publicBenefit];
  }
  const token = randomToken();
  const eventName = nextEvent?.name || 'Próximo evento';
  transaction.set(ref, {
    personId: person.id,
    ticketToken: person.ticketToken,
    qualifyingEventId: event.id,
    eventId: nextEvent?.id || null,
    eventName,
    visitNumber,
    token,
    pending: !nextEvent,
    earnedAt: serverTimestamp(),
    usedAt: null,
  });
  return [...benefits, { token, eventName }];
}

async function registerCheckin(personId, event = currentEvent()) {
  try {
    requireAdmin();
    const person = state.people.find((item) => item.id === personId);
    if (!person || !event) userError('Selecciona una persona y un evento.');
    await runTransaction(db, async (transaction) => {
      const [existingCheckin, ticketSnapshot, eventSnapshot] = await Promise.all([
        transaction.get(checkinRef(event.id, person.id)),
        transaction.get(doc(db, 'tickets', person.ticketToken)),
        transaction.get(doc(db, 'events', event.id)),
      ]);
      if (!eventSnapshot.exists() || ['draft', 'cancelled'].includes(eventSnapshot.data().status)) userError('El evento ya no está disponible para registrar ingresos.');
      if (existingCheckin.exists()) userError(`${person.name} ya tiene un ingreso registrado para este evento.`);
      if (!ticketSnapshot.exists()) userError('No se encontró la boleta de esta persona.');
      const ticket = ticketSnapshot.data();
      const visits = Number(ticket.visits) || 0;
      if (isCourtesy(person) && visits >= 3) userError(`La boleta de cortesía de ${person.name} ya utilizó sus 3 ingresos.`);
      const newVisits = visits + 1;
      const updates = { visits: newVisits };
      const currentEventData = { id: event.id, ...eventSnapshot.data() };
      if (!isCourtesy(person) && newVisits % BENEFIT_VISITS === 0) updates.benefits = await addBenefit(transaction, person, ticket, currentEventData, newVisits / BENEFIT_VISITS);
      transaction.set(checkinRef(event.id, person.id), { personId: person.id, eventId: event.id, type: 'regular', checkedAt: serverTimestamp() });
      transaction.update(doc(db, 'tickets', person.ticketToken), updates);
    });
    setFeedback(`Ingreso registrado: ${person.name}.`);
  } catch (error) { reportOperationError(error); }
}

async function redeemBenefit(benefitToken, event = currentEvent()) {
  try {
    requireAdmin();
    const matches = await getDocs(query(collection(db, 'benefits'), where('token', '==', benefitToken), limit(1)));
    if (matches.empty) userError('Este QR de beneficio no es válido.');
    const benefitSnapshot = matches.docs[0];
    const benefit = { id: benefitSnapshot.id, ...benefitSnapshot.data() };
    if (!event) userError('Selecciona el evento activo para canjear el beneficio.');
    if (benefit.eventId && benefit.eventId !== event.id) userError(`Este beneficio es válido para ${benefit.eventName}.`);
    const person = state.people.find((item) => item.id === benefit.personId);
    if (!person) userError('No se encontró la persona de este beneficio.');
    await runTransaction(db, async (transaction) => {
      const [freshBenefit, existingCheckin, ticketSnapshot, eventSnapshot] = await Promise.all([
        transaction.get(doc(db, 'benefits', benefit.id)),
        transaction.get(checkinRef(event.id, person.id)),
        transaction.get(doc(db, 'tickets', person.ticketToken)),
        transaction.get(doc(db, 'events', event.id)),
      ]);
      if (!eventSnapshot.exists() || ['draft', 'cancelled'].includes(eventSnapshot.data().status)) userError('El evento ya no está disponible para canjear beneficios.');
      if (!freshBenefit.exists() || freshBenefit.data().usedAt) userError('Este QR de beneficio ya fue utilizado.');
      if (freshBenefit.data().eventId && freshBenefit.data().eventId !== event.id) userError(`Este beneficio es válido para ${freshBenefit.data().eventName}.`);
      if (existingCheckin.exists()) userError(`${person.name} ya tiene un ingreso en este evento.`);
      if (!ticketSnapshot.exists()) userError('No se encontró la boleta de este beneficio.');
      const currentEventData = { id: event.id, ...eventSnapshot.data() };
      const ticket = ticketSnapshot.data();
      const benefits = (Array.isArray(ticket.benefits) ? ticket.benefits : []).filter((item) => item.token !== benefit.token);
      transaction.set(checkinRef(event.id, person.id), { personId: person.id, eventId: event.id, type: 'benefit', benefitToken: benefit.token, checkedAt: serverTimestamp() });
      transaction.update(doc(db, 'benefits', benefit.id), { eventId: event.id, eventName: currentEventData.name, pending: false, usedAt: serverTimestamp() });
      transaction.update(doc(db, 'tickets', person.ticketToken), { benefits });
    });
    setFeedback(`Beneficio canjeado para ${person.name}. No se registra asistencia adicional.`);
  } catch (error) { reportOperationError(error); }
}

async function deletePerson(personId) {
  const person = state.people.find((item) => item.id === personId);
  if (!person || !confirm(`Eliminar a ${person.name}, su boleta y sus asistencias?`)) return;
  try {
    requireAdmin();
    const refs = [doc(db, 'people', person.id), doc(db, 'tickets', person.ticketToken)];
    state.checkins.filter((item) => item.personId === person.id).forEach((item) => refs.push(doc(db, 'checkins', item.id)));
    state.benefits.filter((item) => item.personId === person.id).forEach((item) => refs.push(doc(db, 'benefits', item.id)));
    for (let start = 0; start < refs.length; start += 400) {
      const batch = writeBatch(db);
      refs.slice(start, start + 400).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
  } catch (error) { reportOperationError(error); }
}
async function upgradeToRegular(personId) {
  const person = state.people.find((item) => item.id === personId);
  if (!person || !isCourtesy(person) || countVisits(person) < 3) return;
  if (!confirm(`Crear una nueva boleta regular para ${person.name}? La cortesía actual y su QR quedarán invalidados.`)) return;
  try {
    requireAdmin();
    const newTicketToken = randomToken();
    await runTransaction(db, async (transaction) => {
      const [personSnapshot, oldTicketSnapshot] = await Promise.all([
        transaction.get(doc(db, 'people', person.id)),
        transaction.get(doc(db, 'tickets', person.ticketToken)),
      ]);
      if (!personSnapshot.exists() || personSnapshot.data().ticketType !== 'courtesy') userError('Esta persona ya no tiene una boleta de cortesía activa.');
      if (!oldTicketSnapshot.exists() || Number(oldTicketSnapshot.data().visits) < 3) userError('La boleta de cortesía todavía no está agotada.');
      transaction.update(personSnapshot.ref, { ticketType: 'regular', ticketToken: newTicketToken, upgradedAt: serverTimestamp() });
      transaction.set(doc(db, 'tickets', newTicketToken), { name: personSnapshot.data().name, ticketType: 'regular', visits: 0, benefits: [], createdAt: serverTimestamp() });
      transaction.delete(oldTicketSnapshot.ref);
    });
    displayedTicket = { id: newTicketToken, name: person.name, ticketType: 'regular', visits: 0, benefits: [] };
    displayedPersonId = person.id;
    renderTicket($('#ticket-content'), displayedTicket);
    if (!$('#ticket-modal').open) $('#ticket-modal').showModal();
    setFeedback(`Boleta regular creada para ${person.name}. Comparte el nuevo enlace.`);
  } catch (error) { reportOperationError(error); }
}

async function regenerateTicket(personId) {
  const person = state.people.find((item) => item.id === personId);
  if (!person || !confirm(`Regenerar la boleta de ${person.name}? El enlace y QR actuales dejarán de funcionar.`)) return;
  try {
    requireAdmin();
    const newTicketToken = randomToken();
    let regeneratedTicket;
    const benefitMatches = await getDocs(query(collection(db, 'benefits'), where('personId', '==', person.id)));
    if (benefitMatches.docs.length > 12) userError('Esta boleta tiene demasiados beneficios para regenerarse desde el navegador. Contacta al soporte técnico.');
    await runTransaction(db, async (transaction) => {
      const [personSnapshot, oldTicketSnapshot, ...benefitSnapshots] = await Promise.all([
        transaction.get(doc(db, 'people', person.id)),
        transaction.get(doc(db, 'tickets', person.ticketToken)),
        ...benefitMatches.docs.map((item) => transaction.get(doc(db, 'benefits', item.id))),
      ]);
      if (!personSnapshot.exists() || !oldTicketSnapshot.exists()) userError('No se encontró la boleta actual para regenerarla.');
      const oldTicket = oldTicketSnapshot.data();
      const personBenefits = benefitSnapshots.filter((item) => item.exists()).map((item) => ({ id: item.id, ...item.data() }));
      const activeBenefits = personBenefits.filter((benefit) => !benefit.usedAt);
      const refreshedBenefits = activeBenefits.map((benefit) => ({ ...benefit, token: randomToken() }));
      regeneratedTicket = { id: newTicketToken, name: oldTicket.name, ticketType: oldTicket.ticketType, visits: Number(oldTicket.visits) || 0, benefits: refreshedBenefits.map((benefit) => ({ token: benefit.token, eventName: benefit.eventName })) };
      transaction.set(doc(db, 'tickets', newTicketToken), { name: regeneratedTicket.name, ticketType: regeneratedTicket.ticketType, visits: regeneratedTicket.visits, benefits: regeneratedTicket.benefits, createdAt: serverTimestamp() });
      transaction.update(personSnapshot.ref, { ticketToken: newTicketToken, ticketRegeneratedAt: serverTimestamp() });
      refreshedBenefits.forEach((benefit) => transaction.update(doc(db, 'benefits', benefit.id), { ticketToken: newTicketToken, token: benefit.token }));
      personBenefits.filter((benefit) => benefit.usedAt).forEach((benefit) => transaction.update(doc(db, 'benefits', benefit.id), { ticketToken: newTicketToken }));
      transaction.delete(oldTicketSnapshot.ref);
    });
    displayedTicket = regeneratedTicket;
    displayedPersonId = person.id;
    renderTicket($('#ticket-content'), displayedTicket);
    setFeedback(`Boleta regenerada para ${person.name}. Comparte el nuevo enlace.`, false);
  } catch (error) { reportOperationError(error); }
}

async function deleteEvent(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event || !confirm(`Eliminar el evento "${event.name}"?`)) return;
  if (state.checkins.some((item) => item.eventId === eventId) || state.benefits.some((item) => item.eventId === eventId)) {
    return setFeedback('No se puede eliminar un evento que ya tiene ingresos o beneficios asociados.', true);
  }
  try { requireAdmin(); await deleteDoc(doc(db, 'events', eventId)); } catch (error) { reportOperationError(error); }
}

async function createEvent(event) {
  requireAdmin();
  const form = event.currentTarget;
  const eventRef = doc(collection(db, 'events'));
  const newEvent = {
    name: $('#event-name').value.trim(),
    date: $('#event-date').value,
    time: $('#event-time').value,
    location: $('#event-location').value.trim(),
    status: $('#event-status').value,
    imageUrl: $('#event-image-url').value.trim(),
    description: $('#event-description').value.trim(),
    createdAt: serverTimestamp(),
  };
  await setDoc(eventRef, newEvent);
  await resolvePendingBenefits({ id: eventRef.id, ...newEvent });
  form.reset();
  $('#event-date').value = localDate();
  $('#event-form').close();
}

function openEventForm(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  const form = $('#event-form');
  $('#event-id').value = event?.id || '';
  $('#event-form-title').textContent = event ? 'Editar evento' : 'Crear evento';
  $('#event-name').value = event?.name || '';
  $('#event-date').value = event?.date || localDate();
  $('#event-time').value = event?.time || '';
  $('#event-location').value = event?.location || '';
  $('#event-status').value = event?.status || 'published';
  $('#event-image-url').value = event?.imageUrl || '';
  $('#event-description').value = event?.description || '';
  $('#event-form-feedback').textContent = '';
  form.showModal();
}

async function updateEvent(event) {
  requireAdmin();
  const form = event.currentTarget;
  const eventId = $('#event-id').value;
  const existing = state.events.find((item) => item.id === eventId);
  if (!existing) userError('No se encontró el evento para actualizar.');
  const { id: _, ...existingData } = existing;
  const updates = {
    name: $('#event-name').value.trim(),
    date: $('#event-date').value,
    time: $('#event-time').value,
    location: $('#event-location').value.trim(),
    status: $('#event-status').value,
    imageUrl: $('#event-image-url').value.trim(),
    description: $('#event-description').value.trim(),
    updatedAt: serverTimestamp(),
  };
  const existingPublished = existing.status !== 'draft' && existing.status !== 'cancelled';
  if (existingPublished && updates.status !== 'published') userError('Un evento publicado no puede despublicarse desde esta consola. Crea una nueva programación si necesitas reemplazarlo.');
  if (updates.name !== existing.name && (state.checkins.some((item) => item.eventId === eventId) || state.benefits.some((item) => item.eventId === eventId))) userError('No se puede cambiar el nombre de un evento con ingresos o beneficios asociados.');
  const affectedBenefits = updates.name !== existing.name
    ? await getDocs(query(collection(db, 'benefits'), where('eventId', '==', eventId)))
    : null;
  const linkedBenefits = existing.status === 'published' && updates.status !== 'published'
    ? await getDocs(query(collection(db, 'benefits'), where('eventId', '==', eventId)))
    : null;
  if (linkedBenefits?.docs.some((item) => !item.data().usedAt)) userError('No se puede despublicar este evento mientras tenga beneficios disponibles. Canjéalos o reasígnalos primero.');
  if (affectedBenefits && affectedBenefits.docs.length > 180) userError('Este evento tiene demasiados beneficios asignados para cambiar su nombre desde el navegador. Contacta al soporte técnico.');
  if (affectedBenefits) await updateEventAndBenefitNames(eventId, { ...existingData, ...updates }, affectedBenefits, updates.name);
  else await setDoc(doc(db, 'events', eventId), { ...existingData, ...updates }, { merge: false });
  if (existing.status !== 'published' && updates.status === 'published') await resolvePendingBenefits({ id: eventId, ...existingData, ...updates });
  form.reset();
  $('#event-id').value = '';
  $('#event-form').close();
}

async function updateEventAndBenefitNames(eventId, eventData, matches, eventName) {
  await runTransaction(db, async (transaction) => {
    const [eventSnapshot, ...benefitSnapshots] = await Promise.all([
      transaction.get(doc(db, 'events', eventId)),
      ...matches.docs.map((item) => transaction.get(doc(db, 'benefits', item.id))),
    ]);
    if (!eventSnapshot.exists()) userError('No se encontró el evento para actualizar.');
    const benefits = benefitSnapshots.filter((item) => item.exists()).map((item) => ({ id: item.id, ...item.data() }));
    const ticketTokens = [...new Set(benefits.filter((benefit) => !benefit.usedAt).map((benefit) => benefit.ticketToken))];
    const ticketSnapshots = await Promise.all(ticketTokens.map((token) => transaction.get(doc(db, 'tickets', token))));
    transaction.set(eventSnapshot.ref, eventData, { merge: false });
    benefits.forEach((benefit) => transaction.update(doc(db, 'benefits', benefit.id), { eventName }));
    ticketSnapshots.forEach((snapshot) => {
      if (!snapshot.exists()) return;
      const ticketBenefits = Array.isArray(snapshot.data().benefits) ? snapshot.data().benefits : [];
      transaction.update(snapshot.ref, { benefits: ticketBenefits.map((benefit) => benefits.some((item) => item.token === benefit.token) ? { ...benefit, eventName } : benefit) });
    });
  });
}

async function resolvePendingBenefits(newEvent) {
  if (newEvent.status && newEvent.status !== 'published') return;
  const events = [...state.events.filter((event) => event.id !== newEvent.id), newEvent];
  const pending = await getDocs(query(collection(db, 'benefits'), where('eventId', '==', null)));
  for (const pendingSnapshot of pending.docs) {
    const benefit = { id: pendingSnapshot.id, ...pendingSnapshot.data() };
    const qualifyingEvent = events.find((item) => item.id === benefit.qualifyingEventId);
    const nextEvent = qualifyingEvent && nextEventAfter(qualifyingEvent, events);
    if (!nextEvent) continue;
    await runTransaction(db, async (transaction) => {
      const [freshBenefit, ticketSnapshot] = await Promise.all([
        transaction.get(doc(db, 'benefits', benefit.id)),
        transaction.get(doc(db, 'tickets', benefit.ticketToken)),
      ]);
      if (!freshBenefit.exists() || freshBenefit.data().eventId || !ticketSnapshot.exists()) return;
      const ticket = ticketSnapshot.data();
      const benefits = Array.isArray(ticket.benefits) ? ticket.benefits : [];
      transaction.update(doc(db, 'benefits', benefit.id), { eventId: nextEvent.id, eventName: nextEvent.name, pending: false });
      const updatedBenefits = benefits.some((item) => item.token === benefit.token)
        ? benefits.map((item) => item.token === benefit.token ? { token: benefit.token, eventName: nextEvent.name } : item)
        : [...benefits, { token: benefit.token, eventName: nextEvent.name }];
      transaction.update(doc(db, 'tickets', benefit.ticketToken), { benefits: updatedBenefits });
    });
  }
}

async function submitForm(form, operation) {
  if (submittingForms.has(form)) return;
  submittingForms.add(form);
  form.setAttribute('aria-busy', 'true');
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await operation();
  } catch (error) {
    console.error(error);
    const feedback = form.querySelector('.feedback');
    if (feedback) {
      feedback.textContent = error instanceof UserMessageError ? error.message : 'No se pudo guardar el cambio. Revisa tu conexión y los permisos.';
      feedback.classList.add('error');
    } else reportOperationError(error);
  } finally {
    submittingForms.delete(form);
    form.removeAttribute('aria-busy');
    buttons.forEach((button) => { button.disabled = false; });
  }
}

document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => {
  if (!isAdmin) return;
  if (button.dataset.open === 'event-form') openEventForm();
  else if (button.dataset.open === 'person-form') openPersonForm();
  else $(`#${button.dataset.open}`).showModal();
}));
$('#person-search').addEventListener('input', renderPeople);
$('#people-list').addEventListener('click', (event) => {
  const ticketButton = event.target.closest('[data-ticket]');
  const deleteButton = event.target.closest('[data-delete-person]');
  const upgradeButton = event.target.closest('[data-upgrade-person]');
  const regenerateButton = event.target.closest('[data-regenerate-ticket]');
  const editButton = event.target.closest('[data-edit-person]');
  if (ticketButton) showTicket(ticketButton.dataset.ticket);
  if (upgradeButton) upgradeToRegular(upgradeButton.dataset.upgradePerson);
  if (regenerateButton) regenerateTicket(regenerateButton.dataset.regenerateTicket);
  if (editButton) openPersonForm(editButton.dataset.editPerson);
  if (deleteButton) deletePerson(deleteButton.dataset.deletePerson);
});
$('#event-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete-event]');
  const editButton = event.target.closest('[data-edit-event]');
  if (button) deleteEvent(button.dataset.deleteEvent);
  if (editButton) openEventForm(editButton.dataset.editEvent);
});
$('#new-person-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') return $('#person-form').close();
  await submitForm(event.currentTarget, () => $('#person-id').value ? updatePerson(event) : createPerson(event));
});
$('#new-event-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') return $('#event-form').close();
  await submitForm(event.currentTarget, () => $('#event-id').value ? updateEvent(event) : createEvent(event));
});
$('#manual-checkin').addEventListener('click', () => submitEntry(() => registerCheckin($('#manual-person').value, currentEvent())));
$('#manual-code-checkin').addEventListener('click', () => submitEntry(async () => {
  const payload = payloadFromValue($('#manual-ticket-code').value);
  if (payload.app !== APP_NAME) userError('Este código no pertenece a Live! Vive el Arte.');
  if (payload.type === 'benefit') return redeemBenefit(payload.benefitToken, currentEvent());
  const person = state.people.find((item) => item.ticketToken === payload.ticketToken);
  if (!person) userError('No se encontró una persona para esta boleta.');
  return registerCheckin(person.id, currentEvent());
}));
$('#active-event').addEventListener('change', () => {
  setFeedback('');
  updateEntryControls();
});
$('#close-ticket').addEventListener('click', () => $('#ticket-modal').close());
$('#share-ticket').addEventListener('click', shareTicket);
$('#copy-ticket').addEventListener('click', copyTicketLink);
$('#regenerate-ticket').addEventListener('click', () => regenerateTicket(displayedPersonId));
$('#sign-in').addEventListener('click', () => $('#auth-form').showModal());
$('#admin-auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') return $('#auth-form').close();
  const email = $('#admin-email').value.trim();
  const password = $('#admin-password').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    $('#auth-feedback').textContent = '';
    $('#auth-form').close();
  } catch (error) {
    console.error(error);
    $('#auth-feedback').textContent = authErrorMessage(error);
    $('#auth-feedback').classList.add('error');
  }
});
$('#sign-out').addEventListener('click', () => signOut(auth));

async function startScanner() {
  if (scanner || scannerStarting || entryInFlight) return;
  const event = currentEvent();
  if (!event) return setFeedback('Selecciona el evento activo antes de abrir la cámara.', true);
  if (!canRegisterEntries()) {
    setFeedback(navigator.onLine ? 'Espera a que los datos terminen de sincronizar.' : 'No hay conexión. No se puede abrir la cámara.', true);
    updateConnectionStatus();
    return;
  }
  if (!window.isSecureContext) return setFeedback('La cámara requiere abrir la página mediante HTTPS.', true);
  if (!navigator.mediaDevices?.getUserMedia) return setFeedback('Este navegador no permite usar la cámara. Abre la administración en Chrome, Safari o Firefox.', true);
  scannerStarting = true;
  updateEntryControls();
  try {
    setFeedback('Solicitando permiso de cámara...');
    const permissionStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    permissionStream.getTracks().forEach((track) => track.stop());
    if (!scannerStarting) return;
    setFeedback('Cargando lector QR...');
    const Html5Qrcode = await loadScannerLibrary();
    if (!scannerStarting) return;
    const cameras = await Html5Qrcode.getCameras();
    if (!scannerStarting) return;
    if (!cameras.length) userError('Este dispositivo no tiene una cámara disponible. Usa el ingreso manual.');
    const cameraChoice = $('#camera-choice');
    const cameraSelect = $('#camera-select');
    const selectedCamera = cameraSelect.value;
    cameraSelect.replaceChildren(...cameras.map((camera, index) => {
      const option = document.createElement('option');
      option.value = camera.id;
      option.textContent = camera.label || `Cámara ${index + 1}`;
      return option;
    }));
    const rearCamera = cameras.find((camera) => /back|rear|environment|trasera/i.test(camera.label));
    cameraSelect.value = cameras.some((camera) => camera.id === selectedCamera) ? selectedCamera : (rearCamera?.id || cameras[0].id);
    cameraChoice.hidden = cameras.length < 2;
    $('#qr-reader').hidden = false;
    $('#start-scanner').hidden = true;
    $('#stop-scanner').hidden = false;
    let activeScanner = new Html5Qrcode('qr-reader');
    scanner = activeScanner;
    const scanConfig = { fps: 10, qrbox: { width: 220, height: 220 } };
    const onDecode = async (decoded) => {
      if (scannerDecoding || entryInFlight) return;
      scannerDecoding = true;
      try {
        let payload;
        try { payload = JSON.parse(decoded); } catch (_) { userError('Este código QR no pertenece a Live! Vive el Arte.'); }
        if (payload.app !== APP_NAME) userError('Este código QR no pertenece a Live! Vive el Arte.');
        let operation;
        if (payload.type === 'benefit') operation = () => redeemBenefit(payload.benefitToken, event);
        else {
          const person = state.people.find((item) => item.ticketToken === payload.ticketToken);
          if (!person) userError('No se encontró una persona para esta boleta.');
          operation = () => registerCheckin(person.id, event);
        }
        await stopScanner(true);
        await submitEntry(operation, true);
      } catch (error) { reportOperationError(error); } finally { scannerDecoding = false; }
    };
    try {
      await activeScanner.start({ deviceId: { exact: cameraSelect.value } }, scanConfig, onDecode);
    } catch (selectedCameraError) {
      if (!scannerStarting) throw selectedCameraError;
      try { await activeScanner.clear(); } catch (_) { /* The selected camera never completed startup. */ }
      activeScanner = new Html5Qrcode('qr-reader');
      scanner = activeScanner;
      await activeScanner.start({ facingMode: { ideal: 'environment' } }, scanConfig, onDecode);
      setFeedback('La cámara elegida no respondió. Se está usando una cámara disponible.');
    }
  } catch (error) {
    console.error(error);
    setFeedback(cameraErrorMessage(error), true);
    stopScanner();
  } finally {
    scannerStarting = false;
    updateEntryControls();
  }
}
async function stopScanner(keepDecodeLock = false) {
  const activeScanner = scanner;
  scanner = null;
  scannerStarting = false;
  if (activeScanner) {
    try { await activeScanner.stop(); } catch (_) { /* The scanner did not start completely. */ }
    try { await activeScanner.clear(); } catch (_) { /* The scanner was already cleared. */ }
  }
  if (!keepDecodeLock) scannerDecoding = false;
  $('#qr-reader').hidden = true;
  $('#start-scanner').hidden = false;
  $('#stop-scanner').hidden = true;
  updateEntryControls();
}
$('#start-scanner').addEventListener('click', startScanner);
$('#stop-scanner').addEventListener('click', stopScanner);
$('#camera-select').addEventListener('change', async () => {
  if (!scanner) return;
  await stopScanner();
  startScanner();
});

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopScanner();
});
window.addEventListener('pagehide', () => { stopScanner(); });

$('#event-date').value = localDate();
onAuthStateChanged(auth, async (user) => {
  stopScanner();
  stopOperationalListeners();
  isAdmin = false;
  if (user) {
    try {
      const membership = await getDoc(doc(db, 'admins', user.uid));
      isAdmin = auth.currentUser?.uid === user.uid && membership.exists();
    } catch (error) { console.error('No se pudo verificar la membresía de administrador.', error); }
  }
  if (auth.currentUser?.uid !== user?.uid) return;
  updateAccessUi(user);
  if (isAdmin) listenToOperationalData();
});
