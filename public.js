import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { collection, doc, getFirestore, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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
const TICKET_STAMP_LAYOUTS = {
  regular: [
    { x: 49, y: 55, size: 15 },
    { x: 61, y: 55, size: 15 },
    { x: 73, y: 55, size: 15 },
    { x: 49, y: 67, size: 15 },
    { x: 61, y: 67, size: 15 },
  ],
  courtesy: [
    { x: 60, y: 55, size: 11 },
    { x: 72, y: 55, size: 11 },
    { x: 83, y: 55, size: 11 },
  ],
};
let previousPublicTicketState = null;
let publicTicketRenderId = 0;

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
    new QRCode(container, { text: JSON.stringify(payload), width: 116, height: 116, colorDark: color, colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
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

function ticketProgress(ticket) {
  const visits = Number(ticket.visits) || 0;
  const courtesy = ticket.ticketType === 'courtesy';
  const required = courtesy ? 3 : 5;
  const progress = courtesy ? Math.min(visits, required) : visits % required;
  return { visits, courtesy, required, progress };
}

function renderTicket(ticket) {
  const container = $('#public-ticket-content');
  const { visits, courtesy, required, progress } = ticketProgress(ticket);
  const benefits = Array.isArray(ticket.benefits) ? ticket.benefits : [];
  const layout = courtesy ? TICKET_STAMP_LAYOUTS.courtesy : TICKET_STAMP_LAYOUTS.regular;
  const renderId = ++publicTicketRenderId;
  const statusStamps = layout.map((stamp, index) => `<span class="reference-stamp${index < progress ? ' active' : ''}" style="--stamp-x: ${stamp.x}%; --stamp-y: ${stamp.y}%; --stamp-size: ${stamp.size}%;" aria-label="Visita ${index + 1}${index < progress ? ' registrada' : ' pendiente'}" data-stamp-index="${index}"></span>`).join('');
  const description = courtesy
    ? visits >= required
      ? 'Las 3 cortesías ya fueron utilizadas. Esta boleta no admite más ingresos.'
      : `Entrada de cortesía: ${progress} de ${required} miércoles utilizados.`
    : `${progress} de ${required} asistencias en el ciclo actual · ${visits} en total.`;
  const benefitMarkup = benefits.map((benefit, index) => `<div class="ticket-qr-item reward-qr"><span>BENEFICIO · ${benefit.eventName}</span><div id="benefit-qr-${renderId}-${index}" class="qr" aria-label="QR de beneficio para ${benefit.eventName}"></div></div>`).join('');
  const upgradeNote = courtesy && visits >= required ? '<p class="ticket-upgrade-note">¿Quieres seguir asistiendo? Solicita al equipo Live! tu nueva boleta regular.</p>' : '';
  const article = create('article', undefined, `ticket ticket-reference ${courtesy ? 'ticket-courtesy' : 'ticket-regular'}`);
  article.innerHTML = `<div class="ticket-art"><img src="${courtesy ? 'boleta%201.jpeg' : 'Boleta%202.jpeg'}" width="${courtesy ? 1536 : 1080}" height="${courtesy ? 1024 : 1440}" alt="Boleta ${courtesy ? 'de cortesía' : 'regular'} Vive el Arte" />${statusStamps}</div><section class="ticket-personal"><div><p class="ticket-label">BOLETA DIGITAL · ${courtesy ? 'CORTESÍA' : 'REGULAR'}</p><p class="ticket-person">${ticket.name || 'Boleta Live!'}</p><span class="ticket-code">CÓDIGO DE COMUNIDAD: ${ticket.id.slice(0, 8).toUpperCase()}</span><p class="ticket-visits">${description}</p>${upgradeNote}</div><div class="ticket-codes"><div class="ticket-qr-item"><span>INGRESO</span><div id="ticket-qr-${renderId}" class="qr" aria-label="Código QR de ${ticket.name || 'Boleta'}"></div></div>${benefitMarkup}</div></section>`;
  article.setAttribute('data-benefit-tokens', benefits.map((b) => b.token).join(','));
  article.setAttribute('data-ticket-token', ticket.id);
  container.replaceChildren(article);
  loadQrLibrary().then((QRCode) => {
    requestAnimationFrame(() => {
      const renderQr = (element, data, color) => {
        if (!element) return;
        const size = Math.max(70, Math.round(element.getBoundingClientRect().width));
        new QRCode(element, { text: JSON.stringify(data), width: size, height: size, colorDark: color || '#003c2d', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      };
      renderQr($(`#ticket-qr-${renderId}`), { app: APP_NAME, ticketToken: ticket.id });
      benefits.forEach((benefit, index) => renderQr($(`#benefit-qr-${renderId}-${index}`), { app: APP_NAME, type: 'benefit', benefitToken: benefit.token }, '#d41918'));
    });
  }).catch((error) => {
    console.error(error);
    const entryQr = $(`#ticket-qr-${renderId}`);
    if (entryQr) entryQr.textContent = 'No se pudo cargar el QR.';
  });
  previousPublicTicketState = { ticketToken: ticket.id, visits: ticket.visits, benefits: benefits.map((b) => b.token).join(','), required, courtesy };
}

function updateTicketStamps(container, ticket) {
  const { courtesy, required, progress } = ticketProgress(ticket);
  const stamps = container.querySelectorAll('.reference-stamp');
  stamps.forEach((stamp, index) => {
    const wasActive = stamp.classList.contains('active');
    const shouldBeActive = index < progress;
    if (shouldBeActive && !wasActive) {
      stamp.classList.add('active', 'animate-in');
      stamp.setAttribute('aria-label', `Visita ${index + 1} registrada`);
      stamp.addEventListener('animationend', () => stamp.classList.remove('animate-in'), { once: true });
    } else if (!shouldBeActive && wasActive) {
      stamp.classList.remove('active');
      stamp.setAttribute('aria-label', `Visita ${index + 1} pendiente`);
    }
  });
}

function updateTicketVisitText(container, ticket) {
  const { visits, courtesy, required, progress } = ticketProgress(ticket);
  const visitsEl = container.querySelector('.ticket-visits');
  if (visitsEl) {
    visitsEl.textContent = courtesy
      ? (visits >= required ? 'Las 3 cortesías ya fueron utilizadas. Esta boleta no admite más ingresos.' : `Entrada de cortesía: ${progress} de ${required} miércoles utilizados.`)
      : `${progress} de ${required} asistencias en el ciclo actual · ${visits} en total.`;
  }
}

function updateTicketBenefits(container, ticket) {
  const benefits = Array.isArray(ticket.benefits) ? ticket.benefits : [];
  const currentTokens = benefits.map((b) => b.token).join(',');
  const renderedTokens = container.getAttribute('data-benefit-tokens') || '';
  if (currentTokens !== renderedTokens) {
    container.setAttribute('data-benefit-tokens', currentTokens);
    const codes = container.querySelector('.ticket-codes');
    if (!codes) return;
    codes.querySelectorAll('.ticket-qr-item.reward-qr').forEach((el) => el.remove());
    benefits.forEach((benefit, index) => {
      const benefitCard = create('div', undefined, 'ticket-qr-item reward-qr');
      benefitCard.append(create('span', `BENEFICIO · ${benefit.eventName}`));
      const benefitQr = create('div', undefined, 'qr');
      benefitCard.append(benefitQr);
      codes.append(benefitCard);
      appendQr(benefitQr, { app: APP_NAME, type: 'benefit', benefitToken: benefit.token }, '#d41918');
    });
  }
}

function updatePublicTicketRealtime(ticket) {
  const container = $('#public-ticket-content');
  const article = container.querySelector('.ticket');
  if (!article) { renderTicket(ticket); return; }
  const prev = previousPublicTicketState;
  const currentBenefitTokens = (Array.isArray(ticket.benefits) ? ticket.benefits : []).map((b) => b.token).join(',');
  if (prev && prev.ticketToken === ticket.id && prev.visits !== ticket.visits) {
    updateTicketStamps(article, ticket);
    updateTicketVisitText(article, ticket);
  }
  if (prev && prev.ticketToken === ticket.id && prev.benefits !== currentBenefitTokens) {
    updateTicketBenefits(article, ticket);
  }
  if (!prev || prev.ticketToken !== ticket.id) renderTicket(ticket);
  const { required, courtesy } = ticketProgress(ticket);
  previousPublicTicketState = { ticketToken: ticket.id, visits: ticket.visits, benefits: currentBenefitTokens, required, courtesy };
}

async function copyTicketLink(ticket) {
  const status = $('#public-ticket-status');
  try {
    await navigator.clipboard.writeText(ticketUrl(ticket.id));
    status.textContent = 'Enlace copiado. Guárdalo en un lugar seguro.';
  } catch (error) {
    console.error(error);
    status.textContent = 'No se pudo copiar el enlace. Selecciónalo desde la barra del navegador.';
  }
}

async function shareTicket(ticket) {
  const status = $('#public-ticket-status');
  const data = { title: 'Mi boleta Live! Vive el Arte', text: 'Esta es mi boleta personal de Live! Vive el Arte.', url: ticketUrl(ticket.id) };
  try {
    if (navigator.share) await navigator.share(data);
    else await copyTicketLink(ticket);
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error(error);
      status.textContent = 'No se pudo compartir el enlace.';
    }
  }
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
    $('#public-ticket-status').textContent = 'Tu boleta se actualiza en tiempo real.';
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
