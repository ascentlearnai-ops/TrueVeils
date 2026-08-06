const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = Boolean(navigator.connection?.saveData);

function runBootSequence() {
  const boot = document.querySelector('.boot-sequence');
  const copy = boot?.querySelector('.boot-copy');
  if (!boot) return;

  if (reducedMotion || sessionStorage.getItem('truveil-boot-seen')) {
    boot.remove();
    return;
  }

  const messages = ['Establishing session', 'Verifying transcript relay', 'Ready'];
  let index = 0;
  const advance = () => {
    if (!copy) return;
    copy.textContent = messages[index];
    index += 1;
    if (index < messages.length) {
      setTimeout(advance, 330);
      return;
    }
    setTimeout(() => boot.classList.add('sweep'), 180);
    setTimeout(() => {
      boot.classList.add('done');
      sessionStorage.setItem('truveil-boot-seen', '1');
    }, 580);
  };
  advance();
}

runBootSequence();

const nav = document.querySelector('[data-site-nav]');
const updateNav = () => nav?.classList.toggle('scrolled', scrollY > 80);
addEventListener('scroll', updateNav, { passive: true });
updateNav();

const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('visible');
    revealObserver.unobserve(entry.target);
  });
}, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

document.querySelectorAll('.reveal').forEach((element, index) => {
  element.style.transitionDelay = reducedMotion ? '0ms' : `${Math.min(index % 3, 2) * 70}ms`;
  revealObserver.observe(element);
});

const navLinks = [...document.querySelectorAll('.site-nav nav a')];
const trackedSections = navLinks
  .map(link => document.querySelector(link.getAttribute('href')))
  .filter(Boolean);

const sectionObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`));
  });
}, { rootMargin: '-35% 0px -58% 0px' });
trackedSections.forEach(section => sectionObserver.observe(section));

const transcript = document.querySelector('[data-live-transcript]');
const transcriptLines = [
  'We had a queue backlog after a schema change, so I first rolled back the release...',
  'The consumers were still holding the old schema. We drained those and replayed the failed jobs.',
  'Afterward I added a compatibility check to the deploy pipeline so the same failure could not repeat.'
];

if (transcript && !reducedMotion) {
  let line = 0;
  let character = 0;
  const type = () => {
    const current = transcriptLines[line];
    transcript.textContent = current.slice(0, character);
    if (character <= current.length) {
      character += 1;
      setTimeout(type, 28);
      return;
    }
    setTimeout(() => {
      line = (line + 1) % transcriptLines.length;
      character = 0;
      type();
    }, 2200);
  };
  type();
}

const heroEvents = [...document.querySelectorAll('.evidence-pane .event-row')];
heroEvents.forEach((event, index) => {
  event.animate(
    [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
    { duration: reducedMotion ? 1 : 550, delay: reducedMotion ? 0 : 700 + index * 550, fill: 'both', easing: 'cubic-bezier(.16,1,.3,1)' }
  );
});

if (!reducedMotion) {
  const monitor = document.querySelector('.monitor-assembly');
  const vault = document.querySelector('.session-vault');
  let ticking = false;
  const updateScenes = () => {
    const heroProgress = Math.min(scrollY / Math.max(innerHeight, 1), 1);
    if (monitor) monitor.style.transform = `translate(-50%, ${heroProgress * -46}px)`;
    if (vault) {
      const bounds = vault.closest('.problem-section')?.getBoundingClientRect();
      const progress = bounds ? Math.min(1, Math.max(0, (innerHeight - bounds.top) / (innerHeight + bounds.height))) : 0;
      vault.style.opacity = String(0.82 - progress * 0.42);
    }
    ticking = false;
  };
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateScenes);
  }, { passive: true });
}

const tour = document.querySelector('[data-feature-tour]');
const tourProgress = document.querySelector('[data-tour-progress]');
if (tour && tourProgress) {
  const updateTour = () => {
    const distance = tour.scrollWidth - tour.clientWidth;
    const progress = distance > 0 ? tour.scrollLeft / distance : 0;
    tourProgress.style.width = `${25 + progress * 75}%`;
  };
  tour.addEventListener('scroll', updateTour, { passive: true });
  updateTour();
}

const picker = document.querySelector('[data-finish-picker]');
const finishButtons = picker ? [...picker.querySelectorAll('[data-finish]')] : [];
const selectionRing = picker?.querySelector('.selection-ring');
const finishStage = document.querySelector('[data-finish-stage]');
const finishName = document.querySelector('[data-finish-name]');
const finishPlates = [...document.querySelectorAll('[data-finish-plate]')];

function selectFinish(index, focus = false) {
  const button = finishButtons[index];
  if (!button || !finishStage) return;
  finishButtons.forEach((item, itemIndex) => {
    const selected = itemIndex === index;
    item.setAttribute('aria-checked', String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  finishStage.dataset.finish = button.dataset.finish;
  finishPlates.forEach(plate => plate.classList.toggle('active', plate.dataset.finishPlate === button.dataset.finish));
  if (finishName) finishName.textContent = button.getAttribute('aria-label');
  if (selectionRing) selectionRing.style.transform = `translateX(${index * 58}px)`;
  if (focus) button.focus();
}

finishButtons.forEach((button, index) => {
  button.addEventListener('click', () => selectFinish(index));
  button.addEventListener('keydown', event => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End', ' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % finishButtons.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + finishButtons.length) % finishButtons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = finishButtons.length - 1;
    selectFinish(next, true);
  });
});

const flight = document.querySelector('[data-scroll-flight]');
const flightVideos = [...document.querySelectorAll('[data-flight-video]')];
const flightCopy = [...document.querySelectorAll('[data-flight-copy]')];
const flightProgress = document.querySelector('[data-flight-progress]');
const flightIndex = document.querySelector('[data-flight-index]');
const flightEnabled = flight && flightVideos.length && !reducedMotion && !saveData && matchMedia('(min-width: 761px)').matches;

if (flightEnabled) {
  flightVideos.forEach(video => {
    video.src = video.dataset.src;
    video.preload = 'metadata';
    video.load();
  });

  let flightTicking = false;
  const updateFlight = () => {
    const bounds = flight.getBoundingClientRect();
    const travel = Math.max(flight.offsetHeight - innerHeight, 1);
    const progress = Math.min(1, Math.max(0, -bounds.top / travel));
    const scaled = progress * flightVideos.length;
    const activeIndex = Math.min(flightVideos.length - 1, Math.floor(scaled));
    const localProgress = Math.min(1, scaled - activeIndex);

    flightVideos.forEach((video, index) => {
      const active = index === activeIndex;
      video.classList.toggle('active', active);
      if (!active) {
        video.pause();
        return;
      }
      if (!Number.isFinite(video.duration) || video.readyState < 1) return;
      if (video.seekable.length) {
        const target = Math.min(video.duration - 0.04, Math.max(0, localProgress * video.duration));
        if (Math.abs(video.currentTime - target) > 0.08) video.currentTime = target;
        return;
      }
      video.play().catch(() => {});
    });
    flightCopy.forEach((copy, index) => copy.classList.toggle('active', index === activeIndex));
    if (flightProgress) flightProgress.style.width = `${progress * 100}%`;
    if (flightIndex) flightIndex.textContent = String(activeIndex + 1).padStart(2, '0');
    flightTicking = false;
  };

  addEventListener('scroll', () => {
    if (flightTicking) return;
    flightTicking = true;
    requestAnimationFrame(updateFlight);
  }, { passive: true });
  addEventListener('resize', updateFlight, { passive: true });
  flightVideos.forEach(video => video.addEventListener('loadedmetadata', updateFlight, { once: true }));
  updateFlight();
}

document.querySelectorAll('.faq-list details').forEach(detail => {
  detail.addEventListener('toggle', () => {
    if (!detail.open) return;
    document.querySelectorAll('.faq-list details').forEach(other => {
      if (other !== detail) other.open = false;
    });
  });
});
