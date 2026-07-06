const CursorModule = {
  dot: null, ring: null, cursor: null, mouseX: 0, mouseY: 0, ringX: 0, ringY: 0,
  init() {
    if (window.matchMedia('(hover: none)').matches) return;
    this.cursor = document.createElement('div'); this.cursor.className = 'cursor'; this.cursor.setAttribute('aria-hidden', 'true');
    this.dot = document.createElement('div'); this.dot.className = 'cursor__dot';
    this.ring = document.createElement('div'); this.ring.className = 'cursor__ring';
    this.cursor.append(this.dot, this.ring); document.body.prepend(this.cursor);
    document.body.style.cursor = 'none';
    document.addEventListener('mousemove', e => { this.mouseX = e.clientX; this.mouseY = e.clientY; this.move(); });
    document.querySelectorAll('a, button, [data-hover]').forEach(el => {
      el.addEventListener('mouseenter', () => this.setHover());
      el.addEventListener('mouseleave', () => this.clearHover());
    });
    document.addEventListener('mousedown', () => this.setClick());
    this.animateRing();
  },
  move() { this.dot.style.transform = `translate(${this.mouseX}px, ${this.mouseY}px)`; },
  setHover() { this.cursor.classList.add('cursor--hover'); },
  clearHover() { this.cursor.classList.remove('cursor--hover'); },
  setClick() { this.cursor.classList.add('cursor--click'); setTimeout(() => this.cursor.classList.remove('cursor--click'), 300); },
  animateRing() {
    this.ringX += (this.mouseX - this.ringX) * 0.15; this.ringY += (this.mouseY - this.ringY) * 0.15;
    this.ring.style.transform = `translate(${this.ringX}px, ${this.ringY}px)`;
    requestAnimationFrame(() => this.animateRing());
  }
};
document.addEventListener('DOMContentLoaded', () => CursorModule.init());
