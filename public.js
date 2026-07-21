import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { collection, doc, getFirestore, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { renderTicketMarkup, ticketBenefitMarkup, ticketBenefitTokens, updateTicketDebug, updateTicketRealtimeState } from './ticket.js?v=9';

const firebaseConfig = {
  apiKey: 'AIzaSyBK9l6lVxoAfgiLmLmK2qJCIVwFc0xNfqI',
  authDomain: 'ticket-service-c2eac.firebaseapp.com',
  projectId: 'ticket-service-c2eac',
  storageBucket: 'ticket-service-c2eac.firebasestorage.app',
  messagingSenderId: '1089836979524',
  appId: '1:1089836979524:web:786436a0b9287267ca7311',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const APP_NAME = 'live-vive-el-arte';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// Set only verified public channels. Empty values intentionally hide their buttons.
const PUBLIC_CONFIG = {
  address: '',
  whatsappUrl: '',
  instagramUrl: '',
  mapsUrl: '',
};
const $ = (selector) => document.querySelector(selector);
let qrLibraryPromise;
let installPrompt;
let previousPublicTicketState = null;

function create(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function formatDate(value) {
  if (!value) return '';
  const date = value.toDate ? value.toDate() : new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(date);
}

function localToday() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function extractTicketToken(value) {
  const text = value.trim();
  if (TOKEN_PATTERN.test(text)) return text;
  try {
    const url = new URL(text);
    const token = url.searchParams.get('boleta');
    return token && TOKEN_PATTERN.test(token) ? token : null;
  } catch (_) {
    return null;
  }
}

function ticketUrl(token) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('boleta', token);
  return url.toString();
}

function loadQrLibrary() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  if (qrLibraryPromise) return qrLibraryPromise;
  qrLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
    script.async = true;
    script.onload = () => window.QRCode ? resolve(window.QRCode) : reject(new Error('QRCode no disponible'));
    script.onerror = () => reject(new Error('No se pudo cargar el generador QR'));
    document.head.append(script);
  });
  qrLibraryPromise.catch(() => { qrLibraryPromise = null; });
  return qrLibraryPromise;
}

function appendQr(container, payload, color = '#003c2d') {
  loadQrLibrary().then((QRCode) => {
    if (!container.isConnected) return;
    const size = Math.max(70, Math.round(container.getBoundingClientRect().width));
    new QRCode(container, { text: JSON.stringify(payload), width: size, height: size, colorDark: color, colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    container.querySelectorAll('canvas + img').forEach((fallback) => fallback.remove());
  }).catch(() => {
    container.textContent = 'QR no disponible. Usa el enlace personal.';
  });
}

function renderPublicEvents(events) {
  const container = $('#public-events');
  const status = $('#public-events-status');
  container.replaceChildren();
  const upcoming = events.filter((event) => event.status !== 'draft' && event.status !== 'cancelled' && (!event.date || event.date >= localToday())).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!upcoming.length) {
    container.append(create('p', 'Estamos preparando el próximo encuentro. Síguenos para conocer la nueva programación.', 'events-empty'));
    status.textContent = 'No hay eventos próximos por ahora.';
    return;
  }
  status.textContent = `${upcoming.length} ${upcoming.length === 1 ? 'encuentro disponible' : 'encuentros disponibles'}.`;
  upcoming.forEach((event) => {
    const article = create('article', undefined, 'public-event-card');
    if (event.imageUrl) {
      try {
        const imageUrl = new URL(event.imageUrl, window.location.href);
        if (imageUrl.protocol === 'https:' || imageUrl.protocol === 'http:') {
          const image = document.createElement('img');
          image.src = imageUrl.toString();
          image.alt = `Imagen del evento ${event.name || 'Live!'}`;
          image.loading = 'lazy';
          image.width = 640;
          image.height = 360;
          article.append(image);
        }
      } catch (_) { /* Invalid optional image URLs are not rendered. */ }
    }
    const time = create('time', formatDate(event.date));
    if (event.date) time.dateTime = event.date;
    const title = create('h3', event.name || 'Encuentro Live!');
    const description = create('p', event.description || 'Pronto compartiremos más información sobre este encuentro.');
    article.append(time, title, description);
    const meta = [event.status === 'published' ? 'Programado' : '', event.time, event.location].filter(Boolean).join(' · ');
    if (meta) article.append(create('p', meta, 'event-meta'));
    container.append(article);
  });
}

function renderTicket(ticket) {
  const container = $('#public-ticket-content');
  const benefits = Array.isArray(ticket.benefits) ? ticket.benefits : [];
  container.innerHTML = renderTicketMarkup(ticket);
  const article = container.querySelector('.ticket');
  loadQrLibrary().then((QRCode) => {
    requestAnimationFrame(() => {
      const renderQr = (element, data, color) => {
        if (!element) return;
        const size = Math.max(70, Math.round(element.getBoundingClientRect().width));
        new QRCode(element, { text: JSON.stringify(data), width: size, height: size, colorDark: color || '#003c2d', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
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
  previousPublicTicketState = { ticketToken: ticket.id, visits: ticket.visits, benefits: ticketBenefitTokens(ticket) };
}

function updateTicketBenefits(container, ticket) {
  const benefits = Array.isArray(ticket.benefits) ? ticket.benefits : [];
  const codes = container.querySelector('.ticket-codes');
  if (!codes) return;
  codes.querySelectorAll('[data-benefit-token]').forEach((el) => el.remove());
  benefits.forEach((benefit) => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = ticketBenefitMarkup(benefit);
    const card = wrapper.firstElementChild;
    codes.append(card);
    appendQr(card.querySelector('[data-benefit-qr]'), { app: APP_NAME, type: 'benefit', benefitToken: benefit.token }, '#d41918');
  });
}

function updatePublicTicketRealtime(ticket) {
  const container = $('#public-ticket-content');
  const article = container.querySelector('.ticket');
  if (!article) { renderTicket(ticket); return; }
  if (previousPublicTicketState?.ticketToken !== ticket.id) { renderTicket(ticket); return; }
  const { benefitsChanged } = updateTicketRealtimeState(container, ticket);
  if (benefitsChanged) updateTicketBenefits(container, ticket);
  previousPublicTicketState = { ticketToken: ticket.id, visits: ticket.visits, benefits: ticketBenefitTokens(ticket) };
}

function openPublicTicket(token) {
  document.body.classList.add('ticket-mode');
  if (new URLSearchParams(window.location.search).get('debugStamps') === '1') document.body.classList.add('debug-stamps');
  const sections = ['#inicio', '#como-funciona', '.benefits-section', '#eventos', '#boleta', '#ubicacion', '.faq-section'];
  sections.forEach((selector) => { const node = $(selector); if (node) node.hidden = true; });
  $('#public-ticket-view').hidden = false;
  $('#public-ticket-status').textContent = 'Cargando tu boleta...';
  onSnapshot(doc(db, 'tickets', token), (snapshot) => {
    if (!snapshot.exists()) {
      $('#public-ticket-status').textContent = 'Esta boleta no existe, fue revocada o el enlace no es válido.';
      $('#public-ticket-content').replaceChildren();
      return;
    }
    const ticket = { id: snapshot.id, ...snapshot.data() };
    $('#public-ticket-status').textContent = 'Tu boleta se actualiza en tiempo real. Es personal: no compartas este enlace.';
    updatePublicTicketRealtime(ticket);
    if (!previousPublicTicketState || previousPublicTicketState.ticketToken !== ticket.id) $('#ticket-page-title').focus();
  }, (error) => {
    console.error(error);
    $('#public-ticket-status').textContent = navigator.onLine ? 'No fue posible abrir la boleta. Inténtalo de nuevo.' : 'No hay conexión para abrir esta boleta.';
  });
}

function initTicketAccess() {
  const form = $('#ticket-access-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const token = extractTicketToken($('#ticket-access-input').value);
    const feedback = $('#ticket-access-feedback');
    if (!token) {
      feedback.textContent = 'Pega el enlace completo o un código de boleta válido.';
      return;
    }
    window.location.assign(ticketUrl(token));
  });
}

function renderContact() {
  const address = $('#public-address');
  const actions = $('#public-contact-actions');
  if (PUBLIC_CONFIG.address) address.textContent = PUBLIC_CONFIG.address;
  const links = [
    ['WhatsApp', PUBLIC_CONFIG.whatsappUrl],
    ['Instagram', PUBLIC_CONFIG.instagramUrl],
    ['Abrir ubicación', PUBLIC_CONFIG.mapsUrl],
  ].filter(([, url]) => url);
  if (!links.length) return;
  links.forEach(([label, url]) => {
    const link = create('a', label, 'button button-secondary');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.append(link);
  });
  actions.hidden = false;
}

function initInstallPrompt() {
  const button = $('#install-app');
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const iosHelp = $('#ios-install-help');
  const closeIosHelp = $('#close-ios-install-help');
  if (ios && !standalone) {
    const safari = /Safari/i.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
    button.hidden = false;
    button.textContent = safari ? 'Instalar en iPhone' : 'Abrir en Safari para instalar';
    $('#ios-install-copy').textContent = safari
      ? 'Toca Compartir y selecciona “Añadir a pantalla de inicio”. Después confirma con “Añadir”.'
      : 'Abre esta página en Safari. Luego toca Compartir y selecciona “Añadir a pantalla de inicio”.';
    button.addEventListener('click', () => {
      if (typeof iosHelp.showModal === 'function') iosHelp.showModal();
      else iosHelp.hidden = false;
    });
    closeIosHelp.addEventListener('click', () => {
      if (typeof iosHelp.close === 'function') iosHelp.close();
      else iosHelp.hidden = true;
    });
    return;
  }
  if (localStorage.getItem('live-install-dismissed')) return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    button.hidden = false;
  });
  button.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    button.hidden = true;
    localStorage.setItem('live-install-dismissed', '1');
  });
  window.addEventListener('appinstalled', () => { button.hidden = true; });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((error) => console.error('No se pudo registrar el service worker.', error)));
}

$('#current-year').textContent = new Date().getFullYear();
initTicketAccess();
renderContact();
initInstallPrompt();
registerServiceWorker();

const token = new URLSearchParams(window.location.search).get('boleta');
if (token) {
  document.querySelector('meta[name="robots"]').content = 'noindex,nofollow,noarchive';
  if (TOKEN_PATTERN.test(token)) openPublicTicket(token);
  else {
    $('#public-ticket-view').hidden = false;
    $('#public-ticket-status').textContent = 'El enlace de esta boleta no es válido.';
  }
} else {
  onSnapshot(query(collection(db, 'events'), where('status', '==', 'published')), (snapshot) => renderPublicEvents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), (error) => {
    console.error(error);
    $('#public-events-status').textContent = 'No fue posible consultar la programación en este momento.';
    $('#public-events').replaceChildren(create('p', 'Estamos preparando el próximo encuentro. Inténtalo nuevamente más tarde.', 'events-empty'));
  });
}
