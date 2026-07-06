const NavbarModule = {
  init() {
    this.navbar = document.querySelector('.navbar');
    this.hamburger = document.querySelector('.navbar__hamburger');
    this.links = document.querySelector('.navbar__links');
    this.hamburger.addEventListener('click', () => this.toggleMenu());
    document.querySelectorAll('.navbar__links a').forEach(link => link.addEventListener('click', () => {
      if (this.links.classList.contains('navbar__links--open')) this.toggleMenu();
    }));
    window.addEventListener('scroll', () => this.onScroll());
    document.getElementById('year').textContent = new Date().getFullYear();
  },
  onScroll() { this.navbar.classList.toggle('navbar--scrolled', window.scrollY > 80); },
  toggleMenu() {
    this.links.classList.toggle('navbar__links--open');
    this.hamburger.setAttribute('aria-expanded', this.links.classList.contains('navbar__links--open'));
  }
};
document.addEventListener('DOMContentLoaded', () => NavbarModule.init());
