const RippleModule = {
  init() {
    document.querySelectorAll('[data-ripple]').forEach(btn => {
      btn.addEventListener('click', e => this.createRipple(e, btn));
    });
  },
  createRipple(e, btn) {
    const ripple = document.createElement('span'); ripple.className = 'ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 400);
  }
};
document.addEventListener('DOMContentLoaded', () => RippleModule.init());
