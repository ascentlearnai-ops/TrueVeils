const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/* ── Reveal-on-scroll with per-group stagger ─────────────────── */
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('visible');
    revealObserver.unobserve(entry.target);
  });
}, { threshold: .16 });
document.querySelectorAll('.reveal').forEach(el => {
  const group = el.parentElement ? [...el.parentElement.children].filter(c => c.classList.contains('reveal')) : [el];
  const pos = Math.max(0, group.indexOf(el));
  el.style.transitionDelay = reducedMotion ? '0s' : `${Math.min(pos * 80, 320)}ms`;
  revealObserver.observe(el);
});

/* ── Nav gains a backdrop once scrolled ──────────────────────── */
const nav = document.querySelector('.site-nav');
const onNav = () => nav && nav.classList.toggle('scrolled', scrollY > 12);
addEventListener('scroll', onNav, { passive: true });
onNav();

/* ── Flow steps light up in sequence ─────────────────────────── */
const flowList = document.querySelector('.flow-list');
if (flowList) {
  const steps = [...flowList.querySelectorAll('li')];
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('lit');
      const lit = steps.filter(s => s.classList.contains('lit')).length;
      flowList.style.setProperty('--flow-progress', `${(lit / steps.length) * 100}%`);
      io.unobserve(entry.target);
    });
  }, { threshold: .55 });
  steps.forEach(s => io.observe(s));
}

/* ── Hero console: looping live-transcript typing ────────────── */
const heroType = document.getElementById('liveTypeText');
const heroLines = [
  'We had a queue backlog after a schema change, so I first rolled back the release...',
  'Then I noticed the consumers were still holding the old schema. We drained those and replayed the failed jobs.',
  'After the incident, I added a compatibility check to the deploy pipeline so the same failure could not repeat.'
];
if (heroType) {
  if (reducedMotion) {
    heroType.textContent = heroLines[1];
  } else {
    let li = 0, ci = 0;
    const tick = () => {
      const line = heroLines[li];
      heroType.textContent = line.slice(0, ci);
      if (ci <= line.length) { ci++; setTimeout(tick, 26); return; }
      setTimeout(() => { li = (li + 1) % heroLines.length; ci = 0; tick(); }, 1900);
    };
    tick();
  }
}

/* ── Detection story: scroll-scrubbed pinned scene ───────────── */
const track = document.querySelector('[data-story-track]');
const stage = track && track.querySelector('[data-story]');
const storyType = document.getElementById('storyType');
const STORY_ANSWER = 'I rolled back the deploy first, then checked the queue consumers because the schema mismatch was still replaying failed jobs.';
const signalRows = stage ? [...stage.querySelectorAll('[data-signal]')] : [];
const evidenceLines = stage ? [...stage.querySelectorAll('[data-evidence]')] : [];

function renderStoryFinal() {
  if (!stage) return;
  stage.dataset.phase = '3';
  if (storyType) storyType.textContent = STORY_ANSWER;
  signalRows.forEach(r => r.classList.add('lit'));
  evidenceLines.forEach(l => l.classList.add('lit'));
}

if (stage) {
  // If the scene isn't pinned (small screens) or reduced-motion, show final state.
  const pinned = () => getComputedStyle(stage).position === 'sticky';
  if (reducedMotion) {
    renderStoryFinal();
  } else {
    let ticking = false;
    const update = () => {
      ticking = false;
      // Not pinned (mobile layout): render the final state and stop scrubbing.
      if (!pinned()) { renderStoryFinal(); return; }
      const span = track.offsetHeight - innerHeight;
      const progress = clamp(-track.getBoundingClientRect().top / (span || 1));
      const phase = Math.min(3, Math.floor(progress * 4));
      stage.dataset.phase = String(phase);

      // Phase 0 (0–.25): scrub the candidate answer as it "arrives".
      if (storyType) {
        const p0 = clamp(progress / 0.25);
        storyType.textContent = STORY_ANSWER.slice(0, Math.floor(STORY_ANSWER.length * p0));
      }
      // Phase 1 (.25–.5): light pattern signals one by one.
      const p1 = clamp((progress - 0.25) / 0.25);
      const litSignals = Math.round(p1 * signalRows.length);
      signalRows.forEach((r, i) => r.classList.toggle('lit', i < litSignals));
      // Phase 2 (.5–.75): land evidence lines one by one.
      const p2 = clamp((progress - 0.5) / 0.25);
      const litEvidence = Math.round(p2 * evidenceLines.length);
      evidenceLines.forEach((l, i) => l.classList.toggle('lit', i < litEvidence));
      // Phase 3 handled by CSS via [data-phase="3"].
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    update();
  }
}

/* ── Hero console parallax drift ─────────────────────────────── */
if (!reducedMotion) {
  const parallax = document.querySelector('[data-parallax]');
  if (parallax) {
    let p = false;
    addEventListener('scroll', () => {
      if (p) return; p = true;
      requestAnimationFrame(() => {
        p = false;
        const amt = Math.min(scrollY, innerHeight) * Number(parallax.dataset.parallax || 0);
        parallax.style.transform = `translateY(${-amt}px)`;
      });
    }, { passive: true });
  }
}
