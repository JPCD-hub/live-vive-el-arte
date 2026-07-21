export const TICKET_STAMP_LAYOUTS = {
  regular: [
    { x: 52.37, y: 58.36, zoneSize: 16, maskSize: 54, beanWidth: 29, beanHeight: 40, rotation: 28 },
    { x: 70.30, y: 58.37, zoneSize: 16, maskSize: 54, beanWidth: 29, beanHeight: 40, rotation: 28 },
    { x: 87.86, y: 58.37, zoneSize: 16, maskSize: 54, beanWidth: 29, beanHeight: 40, rotation: 28 },
    { x: 52.26, y: 73.24, zoneSize: 16, maskSize: 54, beanWidth: 29, beanHeight: 40, rotation: 28 },
    { x: 70.24, y: 73.21, zoneSize: 16, maskSize: 54, beanWidth: 29, beanHeight: 40, rotation: 28 },
  ],
  courtesy: [
    { x: 59.88, y: 60.90, zoneSize: 12, maskSize: 56, beanWidth: 30, beanHeight: 41, rotation: 28 },
    { x: 73.84, y: 60.80, zoneSize: 12, maskSize: 56, beanWidth: 30, beanHeight: 41, rotation: 28 },
    { x: 87.68, y: 60.80, zoneSize: 12, maskSize: 56, beanWidth: 30, beanHeight: 41, rotation: 28 },
  ],
};

export function escapeTicketHtml(value = '') {
  const node = document.createElement('div');
  node.textContent = value;
  return node.innerHTML;
}

export function ticketState(ticket) {
  const visits = Number(ticket.visits) || 0;
  const courtesy = ticket.ticketType === 'courtesy';
  const required = courtesy ? 3 : 5;
  if (courtesy) return { visits, courtesy, required, progress: Math.min(visits, required), completedCycles: 0, redeemedCycles: 0 };
  const completedCycles = Math.floor(visits / required);
  const redeemedCycles = Math.min(Math.max(0, Number(ticket.redeemedCycles) || 0), completedCycles);
  const cycleProgress = visits % required;
  const progress = cycleProgress === 0 && completedCycles > redeemedCycles ? required : cycleProgress;
  return { visits, courtesy, required, progress, completedCycles, redeemedCycles };
}

export function ticketBenefitTokens(ticket) {
  return (Array.isArray(ticket.benefits) ? ticket.benefits : []).map((benefit) => benefit.token).join(',');
}

export function ticketVisitText(ticket) {
  const { visits, courtesy, required, progress, completedCycles, redeemedCycles } = ticketState(ticket);
  const benefits = Array.isArray(ticket.benefits) ? ticket.benefits : [];
  if (courtesy) return visits >= required ? 'Las 3 cortesías ya fueron utilizadas. Esta boleta no admite más ingresos.' : `Entrada de cortesía: ${progress} de ${required} miércoles utilizados.`;
  if (progress === required) return benefits.length ? `Completaste el ciclo ${completedCycles}. Ya tienes un beneficio disponible.` : `Completaste el ciclo ${completedCycles}. Tu beneficio se asignará para el próximo evento disponible.`;
  return `${progress} de ${required} asistencias en el ciclo actual · ${visits} en total · ${redeemedCycles} ciclos canjeados.`;
}

export function ticketCycleText(ticket) {
  const { courtesy, completedCycles, redeemedCycles } = ticketState(ticket);
  return courtesy ? '' : `Ciclos completados: ${completedCycles} · canjeados: ${redeemedCycles}`;
}

export function ticketStampMarkup(ticket) {
  const { courtesy, progress } = ticketState(ticket);
  const layout = courtesy ? TICKET_STAMP_LAYOUTS.courtesy : TICKET_STAMP_LAYOUTS.regular;
  return layout.map((stamp, index) => `<span class="reference-stamp${index < progress ? ' active' : ''}" style="--stamp-x:${stamp.x}%;--stamp-y:${stamp.y}%;--stamp-zone-size:${stamp.zoneSize}%;--stamp-mask-size:${stamp.maskSize}%;--bean-width:${stamp.beanWidth}%;--bean-height:${stamp.beanHeight}%;--bean-rotation:${stamp.rotation}deg;" aria-label="Visita ${index + 1}${index < progress ? ' registrada' : ' pendiente'}" data-stamp-index="${index + 1}"><span class="stamp-cross" aria-hidden="true"></span><span class="stamp-debug" data-stamp-debug="${index + 1} · ${stamp.x.toFixed(2)} / ${stamp.y.toFixed(2)}" aria-hidden="true"></span></span>`).join('');
}

export function ticketBenefitMarkup(benefit) {
  const eventName = escapeTicketHtml(benefit.eventName || 'Beneficio');
  const token = escapeTicketHtml(benefit.token);
  return `<div class="ticket-qr-item reward-qr" data-benefit-token="${token}"><span>BENEFICIO · ${eventName}</span><div class="qr-container"><div class="qr" data-benefit-qr="${token}" aria-label="QR de beneficio para ${eventName}"></div></div></div>`;
}

export function renderTicketMarkup(ticket, options = {}) {
  const { assetPrefix = '', label = 'BOLETA DIGITAL' } = options;
  const { courtesy, progress, required, visits } = ticketState(ticket);
  const benefits = Array.isArray(ticket.benefits) ? ticket.benefits : [];
  const imageName = courtesy ? 'boleta%201.jpeg' : 'Boleta%202.jpeg';
  const naturalWidth = courtesy ? 1536 : 1086;
  const naturalHeight = courtesy ? 1024 : 1448;
  const typeLabel = courtesy ? 'CORTESÍA' : 'REGULAR';
  const name = escapeTicketHtml(ticket.name || 'Boleta Live!');
  const token = escapeTicketHtml(ticket.id);
  const upgrade = courtesy && visits >= required;
  return `<article class="ticket ticket-reference ${courtesy ? 'ticket-courtesy' : 'ticket-regular'}" data-ticket-token="${token}" data-benefit-tokens="${ticketBenefitTokens(ticket)}"><div class="ticket-art" data-ticket-layout="${courtesy ? 'courtesy' : 'regular'}"><img src="${assetPrefix}${imageName}" width="${naturalWidth}" height="${naturalHeight}" alt="Boleta ${courtesy ? 'de cortesía' : 'regular'} Vive el Arte" />${ticketStampMarkup(ticket)}<p class="ticket-debug-meta" aria-hidden="true"></p></div><section class="ticket-personal"><div class="ticket-details"><p class="ticket-label">${label} · ${typeLabel}</p><p class="ticket-person">${name}</p><span class="ticket-code">CÓDIGO DE COMUNIDAD: ${token.slice(0, 8).toUpperCase()}</span><p class="ticket-visits">${ticketVisitText(ticket)}</p><div class="ticket-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${required}" aria-valuenow="${progress}"><span class="ticket-progress-fill" style="width:${(progress / required) * 100}%"></span></div><p class="ticket-progress-label">${progress} de ${required}</p><p class="ticket-cycle-count"${courtesy ? ' hidden' : ''}>${ticketCycleText(ticket)}</p><p class="ticket-upgrade-note"${upgrade ? '' : ' hidden'}>¿Quieres seguir asistiendo? Solicita al equipo Live! tu nueva boleta regular.</p></div><div class="ticket-codes"><div class="ticket-qr-item"><span>INGRESO</span><div class="qr-container"><div class="qr" data-entry-qr aria-label="Código QR de ${name}"></div></div></div>${benefits.map(ticketBenefitMarkup).join('')}</div></section></article>`;
}

export function updateTicketRealtimeState(container, ticket) {
  const article = container.querySelector('.ticket');
  if (!article) return { rendered: false, benefitsChanged: false };
  const { visits, courtesy, required, progress } = ticketState(ticket);
  article.querySelectorAll('.reference-stamp').forEach((stamp, index) => {
    const active = index < progress;
    const wasActive = stamp.classList.contains('active');
    stamp.classList.toggle('active', active);
    stamp.setAttribute('aria-label', `Visita ${index + 1} ${active ? 'registrada' : 'pendiente'}`);
    if (active && !wasActive) {
      stamp.classList.add('animate-in');
      stamp.addEventListener('animationend', () => stamp.classList.remove('animate-in'), { once: true });
    }
  });
  const visitsEl = article.querySelector('.ticket-visits');
  if (visitsEl) visitsEl.textContent = ticketVisitText(ticket);
  const progressBar = article.querySelector('.ticket-progress');
  if (progressBar) progressBar.setAttribute('aria-valuenow', String(progress));
  const progressFill = article.querySelector('.ticket-progress-fill');
  if (progressFill) progressFill.style.width = `${(progress / required) * 100}%`;
  const progressLabel = article.querySelector('.ticket-progress-label');
  if (progressLabel) progressLabel.textContent = `${progress} de ${required}`;
  const cycleCount = article.querySelector('.ticket-cycle-count');
  if (cycleCount) cycleCount.textContent = ticketCycleText(ticket);
  const upgradeNote = article.querySelector('.ticket-upgrade-note');
  if (upgradeNote) upgradeNote.hidden = !(courtesy && visits >= required);
  const nextTokens = ticketBenefitTokens(ticket);
  const benefitsChanged = article.dataset.benefitTokens !== nextTokens;
  article.dataset.benefitTokens = nextTokens;
  return { rendered: true, benefitsChanged };
}

export function updateTicketDebug(container) {
  if (!document.body.classList.contains('debug-stamps')) return;
  const art = container.querySelector('.ticket-art');
  const image = art?.querySelector('img');
  const meta = art?.querySelector('.ticket-debug-meta');
  if (!art || !image || !meta) return;
  const update = () => {
    const rect = image.getBoundingClientRect();
    meta.textContent = `${art.dataset.ticketLayout} · natural ${image.naturalWidth}×${image.naturalHeight} · render ${Math.round(rect.width)}×${Math.round(rect.height)}`;
  };
  if (image.complete) update();
  else image.addEventListener('load', update, { once: true });
}
