const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveals = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: .14 });
reveals.forEach(element => observer.observe(element));

if (!reducedMotion) {
  const parallax = document.querySelector('[data-parallax]');
  addEventListener('scroll', () => {
    if (!parallax) return;
    const amount = Math.min(scrollY, innerHeight) * Number(parallax.dataset.parallax || 0);
    parallax.style.marginBottom = `${-amount}px`;
  }, { passive: true });
}

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
