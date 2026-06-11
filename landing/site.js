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
