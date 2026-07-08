const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Staggered reveal-on-scroll
const reveals = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: .14 });
reveals.forEach((element, index) => {
  const siblings = element.parentElement ? [...element.parentElement.children].filter(child => child.classList.contains('reveal')) : [element];
  const position = Math.max(0, siblings.indexOf(element));
  element.style.transitionDelay = reducedMotion ? '0s' : `${Math.min(position * 90, 360)}ms`;
  observer.observe(element);
});

// Nav gains definition once the page scrolls
const nav = document.querySelector('.site-nav');
const onScrollNav = () => nav && nav.classList.toggle('scrolled', scrollY > 12);
addEventListener('scroll', onScrollNav, { passive: true });
onScrollNav();

// Hero console parallax drift
if (!reducedMotion) {
  const parallax = document.querySelector('[data-parallax]');
  addEventListener('scroll', () => {
    if (!parallax) return;
    const amount = Math.min(scrollY, innerHeight) * Number(parallax.dataset.parallax || 0);
    parallax.style.transform = `translateY(${-amount}px)`;
  }, { passive: true });
}

// Workflow timeline draws itself as steps enter view
const flowList = document.querySelector('.flow-list');
if (flowList) {
  const steps = [...flowList.querySelectorAll('li')];
  const stepObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('lit');
      const litCount = steps.filter(step => step.classList.contains('lit')).length;
      flowList.style.setProperty('--flow-progress', `${(litCount / steps.length) * 100}%`);
      stepObserver.unobserve(entry.target);
    });
  }, { threshold: .5 });
  steps.forEach(step => stepObserver.observe(step));
}

// Evidence timeline events land one by one when their panel appears
document.querySelectorAll('.evidence-demo, .console-evidence').forEach(panel => {
  const events = panel.querySelectorAll('.evidence-line, .evidence-event');
  events.forEach((event, index) => {
    event.style.setProperty('--event-delay', reducedMotion ? '0s' : `${240 + index * 340}ms`);
  });
  const eventObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('play-events');
      eventObserver.unobserve(entry.target);
    });
  }, { threshold: .35 });
  eventObserver.observe(panel);
});

// Live transcript typing loop in the hero console
const liveTypeText = document.getElementById('liveTypeText');
const transcriptLines = [
  'We had a queue backlog after a schema change, so I first rolled back the release...',
  'Then I noticed the consumers were still holding the old schema. We drained those and replayed the failed jobs.',
  'After the incident, I added a compatibility check to the deploy pipeline so the same failure could not repeat.'
];

if (liveTypeText) {
  if (reducedMotion) {
    liveTypeText.textContent = transcriptLines[1];
  } else {
    let lineIndex = 0;
    let characterIndex = 0;
    const typeNext = () => {
      const line = transcriptLines[lineIndex];
      liveTypeText.textContent = line.slice(0, characterIndex);
      if (characterIndex <= line.length) {
        characterIndex += 1;
        setTimeout(typeNext, 24);
        return;
      }
      setTimeout(() => {
        lineIndex = (lineIndex + 1) % transcriptLines.length;
        characterIndex = 0;
        typeNext();
      }, 1800);
    };
    typeNext();
  }
}
