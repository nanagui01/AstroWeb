const CountdownModule = {
  TARGET_DATE: new Date('2025-12-31T23:59:59'),
  ALLOW_EXPIRED_CLICK: true,
  init() {
    this.el = document.getElementById('countdown');
    this.cta = document.querySelector('.btn--primary[href="#compra"]');
    if (!this.el) return;
    this.tick();
    this.interval = setInterval(() => this.tick(), 1000);
  },
  tick() {
    const diff = this.TARGET_DATE - Date.now();
    if (diff <= 0) return this.onExpired();
    const { days, hours, minutes, seconds } = this.format(diff);
    this.el.innerHTML = `${days}d ${hours}h ${minutes}m ${seconds}s`;
  },
  onExpired() {
    clearInterval(this.interval);
    this.el.textContent = 'Oferta encerrada';
    if (this.cta) { this.cta.classList.add('cta--expired'); if (!this.ALLOW_EXPIRED_CLICK) this.cta.style.pointerEvents = 'none'; }
  },
  format(ms) {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
    return { days: Math.floor(h / 24), hours: h % 24, minutes: m % 60, seconds: s % 60 };
  }
};
document.addEventListener('DOMContentLoaded', () => CountdownModule.init());
