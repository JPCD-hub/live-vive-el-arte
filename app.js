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
import { renderTicketMarkup, ticketBenefitMarkup, ticketState, updateTicketDebug, updateTicketRealtimeState } from './ticket.js?v=9';

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
let scannerVideoObserver = null;
let displayedTicket = null;
let operationalUnsubscribers = [];
let isAdmin = false;
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
const eventUi = { search: '', filter: 'all', sort: 'upcoming' };
let eventSearchTimer;
let eventsLoaded = false;
let eventLoadError = '';
let activeEventMenuId = null;
let displayedEventDetailsId = null;

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
function ticketRegenerationCount(person) { return Number.isInteger(person?.ticketRegenerationCount) ? person.ticketRegenerationCount : 0; }
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
  const message = messages[error?.name] || `No se pudo abrir la cámara. ${error?.message || 'Revisa el permiso y vuelve a intentarlo.'}`;
  return isAppleMobile() ? `${message} En iPhone, verifica que Safari tenga permiso de Cámara en Ajustes.` : message;
}

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function scannerVideoConstraints() {
  return {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  };
}

function optimizeScannerVideo() {
  const reader = $('#qr-reader');
  scannerVideoObserver?.disconnect();
  const applyInlinePlayback = () => reader.querySelectorAll('video').forEach((video) => {
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.muted = true;
    video.autoplay = true;
  });
  scannerVideoObserver = new MutationObserver(applyInlinePlayback);
  scannerVideoObserver.observe(reader, { childList: true, subtree: true });
  applyInlinePlayback();
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
  eventsLoaded = false;
  eventLoadError = '';
  activeEventMenuId = null;
  updateConnectionStatus();
}

function listenToOperationalData() {
  const listen = (name, apply) => onSnapshot(collection(db, name), { includeMetadataChanges: true }, (snapshot) => {
    operationalSources.set(name, !snapshot.metadata.fromCache);
    apply(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    if (name === 'events') {
      eventsLoaded = true;
      eventLoadError = '';
    }
    render();
    updateConnectionStatus();
  }, (error) => {
    operationalSources.set(name, false);
    console.error(`No se pudo leer ${name}`, error);
    if (name === 'events') {
      eventsLoaded = true;
      eventLoadError = 'No se pudieron cargar los eventos. Revisa tu conexión e inténtalo nuevamente.';
      renderEvents();
    }
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
  refreshDisplayedTicketFromState();
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
    const ticket = ticketForPerson(person);
    const progress = ticket ? ticketState(ticket).progress : isCourtesy(person) ? visits : visits % BENEFIT_VISITS;
    const label = isCourtesy(person) ? 'visitas' : 'ciclo';
    const upgrade = isCourtesy(person) && visits >= 3 ? `<button class="small-button upgrade" data-upgrade-person="${person.id}">Pasar a regular</button>` : '';
    const regenerations = ticketRegenerationCount(person);
    const regenerate = regenerations < 2
      ? `<button class="small-button" data-regenerate-ticket="${person.id}">Regenerar enlace (${regenerations}/2)</button>`
      : '<span class="muted">Límite de regeneraciones (2/2)</span>';
    return `<article class="person-row"><div class="person-main"><p class="person-name">${escapeHtml(person.name)} <span class="ticket-type ${isCourtesy(person) ? 'courtesy' : ''}">${ticketLabel(person)}</span></p><p class="person-detail">${escapeHtml(contact)}</p></div><div class="attendance"><b>${progress}</b> / ${isCourtesy(person) ? 3 : BENEFIT_VISITS} ${label}</div><div class="row-actions"><button class="small-button" data-ticket="${person.id}">Ver boleta</button><button class="small-button" data-edit-person="${person.id}">Editar</button>${regenerate}${upgrade}<button class="small-button delete" data-delete-person="${person.id}">Eliminar</button></div></article>`;
  }).join('');
}
function renderEvents() {
  const list = $('#event-list');
  const empty = $('#events-empty');
  const error = $('#event-error');
  const results = $('#event-results');
  const clearFilters = $('#event-clear-filters');
  if (!list || !empty || !error || !results || !clearFilters) return;
  if (!eventsLoaded) {
    list.setAttribute('aria-busy', 'true');
    list.innerHTML = '<div class="event-card event-card--skeleton" aria-hidden="true"><span></span><span></span><span></span></div><div class="event-card event-card--skeleton" aria-hidden="true"><span></span><span></span><span></span></div><div class="event-card event-card--skeleton" aria-hidden="true"><span></span><span></span><span></span></div>';
    empty.hidden = true;
    results.textContent = 'Cargando eventos...';
    return;
  }

  const hasFilters = Boolean(eventUi.search) || eventUi.filter !== 'all' || eventUi.sort !== 'upcoming';
  clearFilters.hidden = !hasFilters;
  error.hidden = !eventLoadError;
  error.textContent = eventLoadError;
  list.setAttribute('aria-busy', 'false');
  activeEventMenuId = null;

  const events = state.events
    .filter((event) => event.name.toLocaleLowerCase('es-CO').includes(eventUi.search))
    .filter((event) => eventUi.filter === 'all' || eventPresentation(event).key === eventUi.filter)
    .sort((a, b) => compareEvents(a, b, eventUi.sort));

  if (!events.length) {
    list.replaceChildren();
    empty.hidden = false;
    empty.querySelector('b').textContent = state.events.length ? 'No hay eventos que coincidan.' : 'Aún no hay eventos creados.';
    empty.querySelector('span').textContent = state.events.length ? 'Prueba con otra búsqueda o limpia los filtros.' : 'Crea el primer evento para comenzar la programación.';
    results.textContent = state.events.length ? '0 eventos coinciden con los filtros.' : '0 eventos registrados.';
    return;
  }

  empty.hidden = true;
  results.textContent = `${events.length} ${events.length === 1 ? 'evento visible' : 'eventos visibles'}.`;
  list.innerHTML = events.map((event) => eventCardMarkup(event)).join('');
}

function eventPresentation(event) {
  if (event.status === 'draft') return { key: 'draft', label: 'Borrador', past: false };
  const past = event.status === 'cancelled' || event.date < localDate();
  return past ? { key: 'finished', label: 'Finalizado', past: true } : { key: 'published', label: 'Publicado', past: false };
}

function compactEventDate(value) {
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(`${value}T12:00:00`)).replace(/\./g, '').toLocaleUpperCase('es-CO');
}

function eventAttendance(eventId) {
  return state.checkins.filter((item) => item.eventId === eventId).length;
}

function compareEvents(a, b, sort) {
  const attendanceDifference = eventAttendance(b.id) - eventAttendance(a.id);
  if (sort === 'income') return attendanceDifference || a.name.localeCompare(b.name, 'es-CO');
  if (sort === 'alpha') return a.name.localeCompare(b.name, 'es-CO');
  if (sort === 'oldest') return a.date.localeCompare(b.date);
  if (sort === 'recent') return b.date.localeCompare(a.date);
  const today = localDate();
  const rank = (event) => event.date >= today && event.status === 'published' ? 0 : 1;
  return rank(a) - rank(b) || a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'es-CO');
}

function eventCardMarkup(event) {
  const presentation = eventPresentation(event);
  const attendances = eventAttendance(event.id);
  const incomeLabel = `${attendances} ${attendances === 1 ? 'ingreso' : 'ingresos'}`;
  const menuId = `event-menu-${event.id}`;
  const timeLabel = `${formatDate(event.date)}${event.time ? ` a las ${event.time}` : ''}`;
  return `<article class="event-card${presentation.past ? ' event-card--past' : ''}" data-event-id="${event.id}"><header class="event-card__header"><time class="event-card__date" datetime="${event.date}" aria-label="${escapeHtml(timeLabel)}">${compactEventDate(event.date)}</time><div class="event-card__menu"><button class="event-menu-button" type="button" data-event-menu-button aria-label="Acciones del evento" aria-expanded="false" aria-controls="${menuId}">⋮</button><div id="${menuId}" class="event-menu" role="menu" hidden><button type="button" role="menuitem" data-edit-event="${event.id}">Editar</button><button type="button" role="menuitem" data-event-details="${event.id}">Ver detalles</button><button type="button" role="menuitem" data-manage-event="${event.id}">Gestionar ingresos</button><button type="button" role="menuitem" class="event-menu__delete" data-delete-event="${event.id}">Eliminar</button></div></div></header><div class="event-card__body"><h3 class="event-card__title">${escapeHtml(event.name)}</h3><p class="event-card__description">${escapeHtml(event.description || 'Sin descripción disponible.')}</p></div><footer class="event-card__footer"><span class="event-status" data-status="${presentation.key}">Estado: ${presentation.label}</span><span class="event-income"><span aria-hidden="true">↗</span>${incomeLabel}</span></footer></article>`;
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
  const benefits = Array.isArray(ticket.benefits) ? ticket.benefits : [];
  container.innerHTML = renderTicketMarkup(ticket, { assetPrefix: '../', label: 'BOLETA VIRTUAL' });
  const article = container.querySelector('.ticket');
  loadLibrary('https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js', 'QRCode').then((QRCode) => {
    requestAnimationFrame(() => {
      const renderQr = (element, data, color = '#003c2d') => {
        if (!element) return;
        const size = Math.max(70, Math.round(element.getBoundingClientRect().width));
        new QRCode(element, { text: JSON.stringify(data), width: size, height: size, colorDark: color, colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
        element.querySelectorAll('canvas + img').forEach((fallback) => fallback.remove());
      };
      renderQr(article.querySelector('[data-entry-qr]'), { app: APP_NAME, ticketToken: ticket.id });
      benefits.forEach((benefit) => renderQr(article.querySelector(`[data-benefit-qr="${benefit.token}"]`), { app: APP_NAME, type: 'benefit', benefitToken: benefit.token }, '#d41918'));
    });
  }).catch((error) => {
    console.error(error);
    const entryQr = article.querySelector('[data-entry-qr]');
    if (entryQr) entryQr.textContent = 'No se pudo cargar el QR.';
  });
  updateTicketDebug(container);
}
function showTicket(personId) {
  const person = state.people.find((item) => item.id === personId);
  const ticket = person && ticketForPerson(person);
  if (!ticket) return setFeedback('La boleta todavía no está disponible.', true);
  displayedTicket = ticket;
  displayedPersonId = personId;
  updateRegenerateTicketAction(person);
  renderTicket($('#ticket-content'), ticket);
  if (!$('#ticket-modal').open) $('#ticket-modal').showModal();
}

function updateRegenerateTicketAction(person) {
  const button = $('#regenerate-ticket');
  if (!button) return;
  const regenerations = ticketRegenerationCount(person);
  button.disabled = regenerations >= 2;
  button.textContent = regenerations >= 2 ? 'Límite de regeneraciones (2/2)' : `Regenerar boleta (${regenerations}/2)`;
}

function updateTicketBenefitsAdmin(container, ticket) {
  const codes = container.querySelector('.ticket-codes');
  if (!codes) return;
  codes.querySelectorAll('[data-benefit-token]').forEach((el) => el.remove());
  (Array.isArray(ticket.benefits) ? ticket.benefits : []).forEach((benefit) => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = ticketBenefitMarkup(benefit);
    const card = wrapper.firstElementChild;
    codes.append(card);
    loadLibrary('https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js', 'QRCode').then((QRCode) => {
      const element = card.querySelector('[data-benefit-qr]');
      const size = Math.max(70, Math.round(element.getBoundingClientRect().width));
      new QRCode(element, { text: JSON.stringify({ app: APP_NAME, type: 'benefit', benefitToken: benefit.token }), width: size, height: size, colorDark: '#d41918', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      element.querySelectorAll('canvas + img').forEach((fallback) => fallback.remove());
    });
  });
}

function refreshDisplayedTicketFromState() {
  if (!displayedTicket || !document.querySelector('#ticket-modal')?.open) return;
  const updatedTicket = state.tickets.get(displayedTicket.id);
  if (!updatedTicket) return;
  const prevVisits = displayedTicket.visits;
  displayedTicket = updatedTicket;
  const container = document.querySelector('#ticket-content');
  if (!container) return;
  const newVisits = updatedTicket.visits;
  const { benefitsChanged } = updateTicketRealtimeState(container, updatedTicket);
  if (benefitsChanged) updateTicketBenefitsAdmin(container, updatedTicket);
  if (prevVisits !== newVisits || benefitsChanged) {
    const region = document.querySelector('#ticket-live-region');
    if (region && prevVisits !== newVisits) region.textContent = `Asistencia registrada. Total: ${newVisits} visitas.`;
  }
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
      const completedCycles = Math.floor((Number(ticket.visits) || 0) / BENEFIT_VISITS);
      const redeemedCycles = Math.min(completedCycles, (Number(ticket.redeemedCycles) || 0) + 1);
      transaction.update(doc(db, 'tickets', person.ticketToken), { benefits, redeemedCycles });
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
  const currentRegenerations = ticketRegenerationCount(person);
  if (!person) return;
  if (currentRegenerations >= 2) return setFeedback(`${person.name} ya alcanzó el límite de dos regeneraciones.`, true);
  const preservesProgress = currentRegenerations === 0;
  const confirmation = preservesProgress
    ? `Regenerar la boleta de ${person.name}? Esta primera regeneración conservará su progreso, pero invalidará el enlace y QR actuales.`
    : `Regenerar la boleta de ${person.name}? Esta segunda y última regeneración reiniciará visitas, ciclos y beneficios pendientes.`;
  if (!confirm(confirmation)) return;
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
      const regenerationCount = ticketRegenerationCount(personSnapshot.data());
      if (regenerationCount >= 2) userError('Esta boleta ya alcanzó el límite de dos regeneraciones.');
      const preserveProgress = regenerationCount === 0;
      const oldTicket = oldTicketSnapshot.data();
      const personBenefits = benefitSnapshots.filter((item) => item.exists()).map((item) => ({ id: item.id, ...item.data() }));
      const activeBenefits = personBenefits.filter((benefit) => !benefit.usedAt);
      const refreshedBenefits = preserveProgress ? activeBenefits.map((benefit) => ({ ...benefit, token: randomToken() })) : [];
      regeneratedTicket = {
        id: newTicketToken,
        name: oldTicket.name,
        ticketType: oldTicket.ticketType,
        visits: preserveProgress ? Number(oldTicket.visits) || 0 : 0,
        redeemedCycles: preserveProgress ? Number(oldTicket.redeemedCycles) || 0 : 0,
        benefits: refreshedBenefits.map((benefit) => ({ token: benefit.token, eventName: benefit.eventName })),
      };
      transaction.set(doc(db, 'tickets', newTicketToken), {
        name: regeneratedTicket.name,
        ticketType: regeneratedTicket.ticketType,
        visits: regeneratedTicket.visits,
        redeemedCycles: regeneratedTicket.redeemedCycles,
        benefits: regeneratedTicket.benefits,
        createdAt: serverTimestamp(),
      });
      transaction.update(personSnapshot.ref, { ticketToken: newTicketToken, ticketRegenerationCount: regenerationCount + 1, ticketRegeneratedAt: serverTimestamp() });
      refreshedBenefits.forEach((benefit) => transaction.update(doc(db, 'benefits', benefit.id), { ticketToken: newTicketToken, token: benefit.token }));
      if (!preserveProgress) activeBenefits.forEach((benefit) => transaction.delete(doc(db, 'benefits', benefit.id)));
      personBenefits.filter((benefit) => benefit.usedAt).forEach((benefit) => transaction.update(doc(db, 'benefits', benefit.id), { ticketToken: newTicketToken }));
      transaction.delete(oldTicketSnapshot.ref);
    });
    displayedTicket = regeneratedTicket;
    displayedPersonId = person.id;
    updateRegenerateTicketAction({ ...person, ticketRegenerationCount: currentRegenerations + 1 });
    renderTicket($('#ticket-content'), displayedTicket);
    setFeedback(preservesProgress
      ? `Boleta regenerada para ${person.name}. Se conservó el progreso y queda una regeneración disponible.`
      : `Boleta regenerada para ${person.name}. El progreso se reinició y se alcanzó el límite de dos regeneraciones.`, false);
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

function closeEventMenu({ restoreFocus = false } = {}) {
  if (!activeEventMenuId) return;
  const menu = document.getElementById(activeEventMenuId);
  const button = document.querySelector(`[aria-controls="${activeEventMenuId}"]`);
  if (menu) {
    menu.hidden = true;
    menu.classList.remove('event-menu--up');
  }
  if (button) {
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  }
  activeEventMenuId = null;
}

function toggleEventMenu(button) {
  const menuId = button.getAttribute('aria-controls');
  if (!menuId) return;
  if (activeEventMenuId === menuId) return closeEventMenu({ restoreFocus: true });
  closeEventMenu();
  const menu = document.getElementById(menuId);
  if (!menu) return;
  activeEventMenuId = menuId;
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    menu.classList.toggle('event-menu--up', menuRect.bottom > window.innerHeight - 8 && buttonRect.top > menu.offsetHeight + 8);
  });
}

function showEventDetails(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event) return;
  const presentation = eventPresentation(event);
  const attendances = eventAttendance(event.id);
  const content = $('#event-details-content');
  const incomeLabel = `${attendances} ${attendances === 1 ? 'ingreso' : 'ingresos'}`;
  content.innerHTML = `<div><dt>Fecha</dt><dd><time datetime="${event.date}">${escapeHtml(formatDate(event.date))}${event.time ? ` · ${escapeHtml(event.time)}` : ''}</time></dd></div><div><dt>Estado</dt><dd>${presentation.label}</dd></div><div><dt>Ingresos</dt><dd>${incomeLabel}</dd></div><div><dt>Lugar</dt><dd>${escapeHtml(event.location || 'Sin lugar definido')}</dd></div><div><dt>Descripción</dt><dd>${escapeHtml(event.description || 'Sin descripción disponible.')}</dd></div>`;
  displayedEventDetailsId = event.id;
  $('#event-details').showModal();
}

function manageEventAttendances(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  const select = $('#active-event');
  if (!event || !select) return;
  if ([...select.options].some((option) => option.value === eventId)) {
    select.value = eventId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    setFeedback(`Evento activo: ${event.name}.`);
  } else {
    setFeedback(`No se pueden gestionar ingresos para ${event.name} porque no está publicado.`, true);
  }
  $('#event-details').close();
  document.querySelector('#ingresos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  requestAnimationFrame(() => select.focus());
}

function clearEventFilters() {
  eventUi.search = '';
  eventUi.filter = 'all';
  eventUi.sort = 'upcoming';
  $('#event-search').value = '';
  $('#event-filter').value = 'all';
  $('#event-sort').value = 'upcoming';
  renderEvents();
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
  const menuButton = event.target.closest('[data-event-menu-button]');
  const button = event.target.closest('[data-delete-event]');
  const editButton = event.target.closest('[data-edit-event]');
  const detailsButton = event.target.closest('[data-event-details]');
  const manageButton = event.target.closest('[data-manage-event]');
  if (menuButton) return toggleEventMenu(menuButton);
  if (button) {
    closeEventMenu();
    deleteEvent(button.dataset.deleteEvent);
  }
  if (editButton) {
    closeEventMenu();
    openEventForm(editButton.dataset.editEvent);
  }
  if (detailsButton) {
    closeEventMenu();
    showEventDetails(detailsButton.dataset.eventDetails);
  }
  if (manageButton) {
    closeEventMenu();
    manageEventAttendances(manageButton.dataset.manageEvent);
  }
});
$('#event-search').addEventListener('input', (event) => {
  clearTimeout(eventSearchTimer);
  eventSearchTimer = setTimeout(() => {
    eventUi.search = event.target.value.trim().toLocaleLowerCase('es-CO');
    renderEvents();
  }, 180);
});
$('#event-filter').addEventListener('change', (event) => {
  eventUi.filter = event.target.value;
  renderEvents();
});
$('#event-sort').addEventListener('change', (event) => {
  eventUi.sort = event.target.value;
  renderEvents();
});
$('#event-clear-filters').addEventListener('click', clearEventFilters);
$('#close-event-details').addEventListener('click', () => $('#event-details').close());
$('#event-details-edit').addEventListener('click', () => {
  const eventId = displayedEventDetailsId;
  $('#event-details').close();
  if (eventId) openEventForm(eventId);
});
$('#event-details-manage').addEventListener('click', () => {
  const eventId = displayedEventDetailsId;
  if (eventId) manageEventAttendances(eventId);
});
document.addEventListener('pointerdown', (event) => {
  if (activeEventMenuId && !event.target.closest('.event-card__menu')) closeEventMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeEventMenuId) {
    event.preventDefault();
    closeEventMenu({ restoreFocus: true });
    return;
  }
  const menu = event.target.closest('.event-menu');
  if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const currentIndex = items.indexOf(event.target);
  if (currentIndex < 0) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[nextIndex].focus();
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
    const permissionStream = await navigator.mediaDevices.getUserMedia({ video: scannerVideoConstraints(), audio: false });
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
    if (isAppleMobile()) $('#scan-note').textContent = 'En iPhone, apunta con la cámara trasera, mantén el QR dentro del recuadro y evita cambiar de aplicación.';
    optimizeScannerVideo();
    let activeScanner = new Html5Qrcode('qr-reader');
    scanner = activeScanner;
    const scanConfig = {
      fps: isAppleMobile() ? 8 : 10,
      qrbox: (width, height) => {
        const size = Math.min(width, height, isAppleMobile() ? 260 : 240);
        return { width: size, height: size };
      },
    };
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
    const preferRearCamera = isAppleMobile() && !cameraSelect.dataset.userSelected;
    const startCandidates = preferRearCamera
      ? [scannerVideoConstraints(), { deviceId: { exact: cameraSelect.value } }]
      : [{ deviceId: { exact: cameraSelect.value } }, scannerVideoConstraints()];
    let startError;
    for (let index = 0; index < startCandidates.length; index += 1) {
      try {
        await activeScanner.start(startCandidates[index], scanConfig, onDecode);
        if (index > 0) setFeedback('La cámara elegida no respondió. Se está usando una cámara disponible.');
        startError = null;
        break;
      } catch (error) {
        startError = error;
        if (!scannerStarting) throw error;
        try { await activeScanner.clear(); } catch (_) { /* The selected camera never completed startup. */ }
        activeScanner = new Html5Qrcode('qr-reader');
        scanner = activeScanner;
      }
    }
    if (startError) throw startError;
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
  scannerVideoObserver?.disconnect();
  scannerVideoObserver = null;
  if (activeScanner) {
    try { await activeScanner.stop(); } catch (_) { /* The scanner did not start completely. */ }
    try { await activeScanner.clear(); } catch (_) { /* The scanner was already cleared. */ }
  }
  if (!keepDecodeLock) scannerDecoding = false;
  $('#qr-reader').hidden = true;
  $('#start-scanner').hidden = false;
  $('#stop-scanner').hidden = true;
  $('#scan-note').textContent = 'La cámara se activa solo al solicitarla. Si no está disponible, usa el ingreso manual.';
  updateEntryControls();
}
$('#start-scanner').addEventListener('click', startScanner);
$('#stop-scanner').addEventListener('click', stopScanner);
$('#camera-select').addEventListener('change', async () => {
  if (!scanner) return;
  $('#camera-select').dataset.userSelected = 'true';
  await stopScanner();
  startScanner();
});

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopScanner();
});
window.addEventListener('pagehide', () => { stopScanner(); });

if (new URLSearchParams(window.location.search).get('debugStamps') === '1') {
  document.body.classList.add('debug-stamps');
}

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
