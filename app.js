import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
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
const publicTicketToken = new URLSearchParams(window.location.search).get('boleta');
const state = { people: [], events: [], checkins: [], benefits: [], tickets: new Map() };
const $ = (selector) => document.querySelector(selector);
let scanner = null;
let displayedTicket = null;
let operationalUnsubscribers = [];
let isAdmin = false;
let ticketRenderNumber = 0;
let authIssue = '';
const pendingBenefitSync = new Set();

function localDate() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(value = '') { const node = document.createElement('div'); node.textContent = value; return node.innerHTML; }
function formatDate(value) { return new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(new Date(`${value}T12:00:00`)); }
function isCourtesy(person) { return person.ticketType === 'courtesy'; }
function ticketLabel(ticket) { return ticket.ticketType === 'courtesy' ? 'Cortesía' : 'Regular'; }
function requiredVisits(ticket) { return ticket.ticketType === 'courtesy' ? 3 : BENEFIT_VISITS; }
function cycleVisits(ticket) { return ticket.ticketType === 'courtesy' ? (Number(ticket.visits) || 0) : (Number(ticket.visits) || 0) % BENEFIT_VISITS; }
function ticketForPerson(person) { return state.tickets.get(person.ticketToken); }
function countVisits(person) { return ticketForPerson(person)?.visits ?? state.checkins.filter((checkin) => checkin.personId === person.id).length; }
function sortedEvents() { return state.events.slice().sort((a, b) => a.date.localeCompare(b.date)); }
function currentEvent() { return state.events.find((event) => event.id === $('#active-event').value) || sortedEvents()[0]; }
function nextEventAfter(event, events = state.events) { return events.slice().sort((a, b) => a.date.localeCompare(b.date)).find((candidate) => candidate.date > event.date); }
function setFeedback(message, error = false) {
  const feedback = $('#checkin-feedback');
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
}
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

function updateAccessUi(user = auth.currentUser) {
  const hasTicket = Boolean(publicTicketToken);
  $('#admin-app').hidden = !isAdmin;
  $('#admin-nav').hidden = !isAdmin;
  $('#sign-in').hidden = Boolean(user);
  $('#sign-out').hidden = !user;
  $('#auth-status').textContent = isAdmin
    ? `Administrando como ${user.displayName || user.email}`
    : user
      ? `Esta cuenta aún no tiene acceso de administración. ID: ${user.uid}`
      : authIssue || 'Consulta tu boleta con su enlace personal.';
  $('#public-ticket-view').hidden = !hasTicket;
  $('#public-message').hidden = hasTicket || isAdmin;
}

function stopOperationalListeners() {
  operationalUnsubscribers.forEach((unsubscribe) => unsubscribe());
  operationalUnsubscribers = [];
  state.people = [];
  state.events = [];
  state.checkins = [];
  state.benefits = [];
  state.tickets = new Map();
}

function listenToOperationalData() {
  const listen = (name, apply) => onSnapshot(collection(db, name), (snapshot) => {
    apply(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    render();
  }, (error) => {
    console.error(`No se pudo leer ${name}`, error);
    setFeedback('No se pudieron actualizar los datos operativos.', true);
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
    return `<article class="person-row"><div class="person-main"><p class="person-name">${escapeHtml(person.name)} <span class="ticket-type ${isCourtesy(person) ? 'courtesy' : ''}">${ticketLabel(person)}</span></p><p class="person-detail">${escapeHtml(contact)}</p></div><div class="attendance"><b>${progress}</b> / ${isCourtesy(person) ? 3 : BENEFIT_VISITS} ${label}</div><div class="row-actions"><button class="small-button" data-ticket="${person.id}">Ver boleta</button>${upgrade}<button class="small-button delete" data-delete-person="${person.id}">Eliminar</button></div></article>`;
  }).join('');
}
function renderEvents() {
  $('#event-list').innerHTML = sortedEvents().reverse().map((event) => {
    const attendances = state.checkins.filter((item) => item.eventId === event.id).length;
    return `<article class="event-card"><button class="small-button delete event-delete" data-delete-event="${event.id}">Eliminar</button><span class="event-date">${formatDate(event.date)}</span><h3>${escapeHtml(event.name)}</h3><p>${escapeHtml(event.description || 'Sin descripción.')}</p><span class="event-attendance">${attendances} ingresos</span></article>`;
  }).join('');
}
function renderSelects() {
  const events = sortedEvents();
  const selectedEvent = $('#active-event').value;
  $('#active-event').innerHTML = events.map((event) => `<option value="${event.id}">${escapeHtml(event.name)} · ${formatDate(event.date)}</option>`).join('');
  $('#active-event').value = events.some((event) => event.id === selectedEvent) ? selectedEvent : (events[0]?.id || '');
  const selectedPerson = $('#manual-person').value;
  $('#manual-person').innerHTML = '<option value="">Selecciona una persona</option>' + state.people.slice().sort((a, b) => a.name.localeCompare(b.name)).map((person) => `<option value="${person.id}">${escapeHtml(person.name)} (${countVisits(person)} visitas)</option>`).join('');
  $('#manual-person').value = state.people.some((person) => person.id === selectedPerson) ? selectedPerson : '';
  $('#manual-checkin').disabled = !state.people.length || !events.length;
  $('#start-scanner').disabled = !state.people.length || !events.length;
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
  container.innerHTML = `<article class="ticket ticket-reference ${courtesy ? 'ticket-courtesy' : 'ticket-regular'}"><div class="ticket-art"><img src="${courtesy ? 'boleta%201.jpeg' : 'Boleta%202.jpeg'}" alt="Boleta ${ticketLabel(ticket)} Vive el Arte" />${statusStamps}</div><section class="ticket-personal"><div><p class="ticket-label">BOLETA VIRTUAL · ${ticketLabel(ticket).toUpperCase()}</p><p class="ticket-person">${escapeHtml(ticket.name)}</p><span class="ticket-code">CÓDIGO DE COMUNIDAD: ${ticket.id.slice(0, 8).toUpperCase()}</span><p class="ticket-visits">${description}</p>${upgradeNote}</div><div class="ticket-codes"><div class="ticket-qr-item"><span>INGRESO</span><div id="ticket-qr-${renderId}" class="qr" aria-label="Código QR de ${escapeHtml(ticket.name)}"></div></div>${benefitMarkup}</div></section></article>`;
  new QRCode($(`#ticket-qr-${renderId}`), { text: JSON.stringify({ app: APP_NAME, ticketToken: ticket.id }), width: 116, height: 116, colorDark: '#003c2d', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  benefits.forEach((benefit, index) => {
    new QRCode($(`#benefit-qr-${renderId}-${index}`), { text: JSON.stringify({ app: APP_NAME, type: 'benefit', benefitToken: benefit.token }), width: 116, height: 116, colorDark: '#003c2d', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  });
}
function showTicket(personId) {
  const person = state.people.find((item) => item.id === personId);
  const ticket = person && ticketForPerson(person);
  if (!ticket) return setFeedback('La boleta todavía no está disponible.', true);
  displayedTicket = ticket;
  renderTicket($('#ticket-content'), ticket);
  if (!$('#ticket-modal').open) $('#ticket-modal').showModal();
}
function shareTicket() {
  if (!displayedTicket) return;
  const link = new URL(window.location.href);
  link.search = '';
  link.hash = '';
  link.searchParams.set('boleta', displayedTicket.id);
  const type = displayedTicket.ticketType === 'courtesy' ? 'de cortesía' : 'regular';
  const message = `Hola ${displayedTicket.name}. Esta es tu boleta ${type} de Live! Vive el Arte. Muéstrala al llegar al evento:\n${link}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
}
function listenToPublicTicket() {
  if (!publicTicketToken) return;
  if (!/^[A-Za-z0-9_-]{43}$/.test(publicTicketToken)) {
    $('#public-ticket-status').textContent = 'El enlace de esta boleta no es válido.';
    return;
  }
  $('#public-ticket-status').textContent = 'Cargando tu boleta...';
  onSnapshot(doc(db, 'tickets', publicTicketToken), (snapshot) => {
    if (!snapshot.exists()) {
      $('#public-ticket-status').textContent = 'Esta boleta no existe o ya no está disponible.';
      $('#public-ticket-content').innerHTML = '';
      return;
    }
    $('#public-ticket-status').textContent = 'Tu boleta se actualiza en tiempo real.';
    renderTicket($('#public-ticket-content'), { id: snapshot.id, ...snapshot.data() });
  }, () => {
    $('#public-ticket-status').textContent = 'No fue posible abrir esta boleta.';
  });
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
  renderTicket($('#ticket-content'), displayedTicket);
  $('#ticket-modal').showModal();
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

async function registerCheckin(personId) {
  try {
    requireAdmin();
    const person = state.people.find((item) => item.id === personId);
    const event = currentEvent();
    if (!person || !event) userError('Selecciona una persona y un evento.');
    await runTransaction(db, async (transaction) => {
      const [existingCheckin, ticketSnapshot] = await Promise.all([
        transaction.get(checkinRef(event.id, person.id)),
        transaction.get(doc(db, 'tickets', person.ticketToken)),
      ]);
      if (existingCheckin.exists()) userError(`${person.name} ya tiene un ingreso registrado para este evento.`);
      if (!ticketSnapshot.exists()) userError('No se encontró la boleta de esta persona.');
      const ticket = ticketSnapshot.data();
      const visits = Number(ticket.visits) || 0;
      if (isCourtesy(person) && visits >= 3) userError(`La boleta de cortesía de ${person.name} ya utilizó sus 3 ingresos.`);
      const newVisits = visits + 1;
      const updates = { visits: newVisits };
      if (!isCourtesy(person) && newVisits % BENEFIT_VISITS === 0) updates.benefits = await addBenefit(transaction, person, ticket, event, newVisits / BENEFIT_VISITS);
      transaction.set(checkinRef(event.id, person.id), { personId: person.id, eventId: event.id, type: 'regular', checkedAt: serverTimestamp() });
      transaction.update(doc(db, 'tickets', person.ticketToken), updates);
    });
    setFeedback(`Ingreso registrado: ${person.name}.`);
  } catch (error) { reportOperationError(error); }
}

async function redeemBenefit(benefitToken) {
  try {
    requireAdmin();
    const matches = await getDocs(query(collection(db, 'benefits'), where('token', '==', benefitToken), limit(1)));
    if (matches.empty) userError('Este QR de beneficio no es válido.');
    const benefitSnapshot = matches.docs[0];
    const benefit = { id: benefitSnapshot.id, ...benefitSnapshot.data() };
    const event = currentEvent();
    if (!event) userError('Selecciona el evento activo para canjear el beneficio.');
    if (benefit.eventId && benefit.eventId !== event.id) userError(`Este beneficio es válido para ${benefit.eventName}.`);
    const person = state.people.find((item) => item.id === benefit.personId);
    if (!person) userError('No se encontró la persona de este beneficio.');
    await runTransaction(db, async (transaction) => {
      const [freshBenefit, existingCheckin, ticketSnapshot] = await Promise.all([
        transaction.get(doc(db, 'benefits', benefit.id)),
        transaction.get(checkinRef(event.id, person.id)),
        transaction.get(doc(db, 'tickets', person.ticketToken)),
      ]);
      if (!freshBenefit.exists() || freshBenefit.data().usedAt) userError('Este QR de beneficio ya fue utilizado.');
      if (freshBenefit.data().eventId && freshBenefit.data().eventId !== event.id) userError(`Este beneficio es válido para ${freshBenefit.data().eventName}.`);
      if (existingCheckin.exists()) userError(`${person.name} ya tiene un ingreso en este evento.`);
      if (!ticketSnapshot.exists()) userError('No se encontró la boleta de este beneficio.');
      const ticket = ticketSnapshot.data();
      const newVisits = (Number(ticket.visits) || 0) + 1;
      const benefits = (Array.isArray(ticket.benefits) ? ticket.benefits : []).filter((item) => item.token !== benefit.token);
      const updates = { visits: newVisits, benefits };
      if (newVisits % BENEFIT_VISITS === 0) updates.benefits = await addBenefit(transaction, person, { ...ticket, benefits }, event, newVisits / BENEFIT_VISITS);
      transaction.set(checkinRef(event.id, person.id), { personId: person.id, eventId: event.id, type: 'benefit', checkedAt: serverTimestamp() });
      transaction.update(doc(db, 'benefits', benefit.id), { eventId: event.id, eventName: event.name, pending: false, usedAt: serverTimestamp() });
      transaction.update(doc(db, 'tickets', person.ticketToken), updates);
    });
    setFeedback(`Beneficio canjeado: ingreso registrado para ${person.name}.`);
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
    renderTicket($('#ticket-content'), displayedTicket);
    if (!$('#ticket-modal').open) $('#ticket-modal').showModal();
    setFeedback(`Boleta regular creada para ${person.name}. Comparte el nuevo enlace.`);
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
    description: $('#event-description').value.trim(),
    createdAt: serverTimestamp(),
  };
  await setDoc(eventRef, newEvent);
  await resolvePendingBenefits({ id: eventRef.id, ...newEvent });
  form.reset();
  $('#event-date').value = localDate();
  $('#event-form').close();
}

async function resolvePendingBenefits(newEvent) {
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

document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => {
  if (isAdmin) $(`#${button.dataset.open}`).showModal();
}));
$('#person-search').addEventListener('input', renderPeople);
$('#people-list').addEventListener('click', (event) => {
  const ticketButton = event.target.closest('[data-ticket]');
  const deleteButton = event.target.closest('[data-delete-person]');
  const upgradeButton = event.target.closest('[data-upgrade-person]');
  if (ticketButton) showTicket(ticketButton.dataset.ticket);
  if (upgradeButton) upgradeToRegular(upgradeButton.dataset.upgradePerson);
  if (deleteButton) deletePerson(deleteButton.dataset.deletePerson);
});
$('#event-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete-event]');
  if (button) deleteEvent(button.dataset.deleteEvent);
});
$('#new-person-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') return $('#person-form').close();
  createPerson(event).catch(reportOperationError);
});
$('#new-event-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') return $('#event-form').close();
  createEvent(event).catch(reportOperationError);
});
$('#manual-checkin').addEventListener('click', () => registerCheckin($('#manual-person').value));
$('#close-ticket').addEventListener('click', () => $('#ticket-modal').close());
$('#share-ticket').addEventListener('click', shareTicket);
$('#sign-in').addEventListener('click', () => $('#auth-form').showModal());
$('#admin-auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') return $('#auth-form').close();
  const email = $('#admin-email').value.trim();
  const password = $('#admin-password').value;
  try {
    if (event.submitter?.value === 'create') await createUserWithEmailAndPassword(auth, email, password);
    else await signInWithEmailAndPassword(auth, email, password);
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
  if (!window.Html5Qrcode) return setFeedback('No se pudo cargar el lector QR. Revisa tu conexión.', true);
  $('#qr-reader').hidden = false;
  $('#start-scanner').hidden = true;
  $('#stop-scanner').hidden = false;
  scanner = new Html5Qrcode('qr-reader');
  try {
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 220, height: 220 } }, async (decoded) => {
      try {
        const payload = JSON.parse(decoded);
        if (payload.app !== APP_NAME) throw new Error();
        if (payload.type === 'benefit') await redeemBenefit(payload.benefitToken);
        else {
          const person = state.people.find((item) => item.ticketToken === payload.ticketToken);
          if (!person) userError('No se encontró una persona para esta boleta.');
          await registerCheckin(person.id);
        }
        stopScanner();
      } catch (error) { reportOperationError(error); }
    });
  } catch (error) {
    console.error(error);
    setFeedback('No se pudo abrir la cámara. Autoriza el permiso o registra el ingreso manualmente.', true);
    stopScanner();
  }
}
async function stopScanner() {
  if (scanner) {
    try { await scanner.stop(); } catch (_) { /* The scanner did not start completely. */ }
    scanner.clear();
    scanner = null;
  }
  $('#qr-reader').hidden = true;
  $('#start-scanner').hidden = false;
  $('#stop-scanner').hidden = true;
}
$('#start-scanner').addEventListener('click', startScanner);
$('#stop-scanner').addEventListener('click', stopScanner);

$('#event-date').value = localDate();
listenToPublicTicket();
onAuthStateChanged(auth, async (user) => {
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
