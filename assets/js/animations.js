const AnimationsModule = {
  init() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const hero = document.querySelector('.hero');
    hero.querySelectorAll('[data-animate]').forEach((el, i) => {
      el.style.transitionDelay = `${i * 0.2}s`; el.classList.add('animate--visible');
    });
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('animate--visible'); observer.unobserve(entry.target); } });
    }, { threshold: 0.2 });
    document.querySelectorAll('[data-animate]:not(.hero [data-animate])').forEach(el => observer.observe(el));
  }
};
document.addEventListener('DOMContentLoaded', () => AnimationsModule.init());
