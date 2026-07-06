const FAQModule = {
  init() {
    document.querySelectorAll('.faq__item').forEach(detail => {
      detail.addEventListener('toggle', () => this.onToggle(detail));
    });
  },
  onToggle(detail) {
    if (!detail.open) return;
    document.querySelectorAll('.faq__item').forEach(d => { if (d !== detail) d.open = false; });
  }
};
document.addEventListener('DOMContentLoaded', () => FAQModule.init());
