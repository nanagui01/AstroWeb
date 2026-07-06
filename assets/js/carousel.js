const CarouselModule = {
  init() {
    const mq = window.matchMedia('(max-width: 767px)');
    this.handleChange(mq);
    mq.addEventListener('change', e => this.handleChange(e));
  },
  handleChange(mq) {
    if (mq.matches) this.buildCarousel(); else this.destroyCarousel();
  },
  buildCarousel() {
    if (this.built) return;
    const grid = document.querySelector('.testimonials__grid');
    if (!grid) return;
    const cards = Array.from(grid.children);
    grid.style.display = 'none';
    const wrapper = document.querySelector('.testimonials__carousel-wrapper') || document.createElement('div');
    wrapper.className = 'testimonials__carousel-wrapper';
    const carousel = document.createElement('div'); carousel.className = 'testimonials__carousel';
    cards.forEach(c => { c.style.minWidth = '80vw'; c.style.flexShrink = '0'; carousel.appendChild(c); });
    wrapper.appendChild(carousel);
    grid.parentNode.insertBefore(wrapper, grid.nextSibling);
    this.carousel = carousel; this.index = 0;
    document.querySelector('.carousel-controls').style.display = 'flex';
    document.querySelector('.carousel-controls .prev').onclick = () => this.prev();
    document.querySelector('.carousel-controls .next').onclick = () => this.next();
    this.built = true;
  },
  destroyCarousel() {
    if (!this.built) return;
    const wrapper = document.querySelector('.testimonials__carousel-wrapper');
    if (wrapper) wrapper.remove();
    document.querySelector('.testimonials__grid').style.display = '';
    document.querySelector('.carousel-controls').style.display = '';
    this.built = false;
  },
  next() { this.index = Math.min(this.index + 1, this.carousel.children.length - 1); this.update(); },
  prev() { this.index = Math.max(this.index - 1, 0); this.update(); },
  update() { this.carousel.style.transform = `translateX(-${this.index * 100}%)`; }
};
document.addEventListener('DOMContentLoaded', () => CarouselModule.init());
