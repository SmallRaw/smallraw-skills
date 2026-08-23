(() => {
  const root = document.documentElement;
  root.classList.add('vc-motion-ready');

  const init = () => {
    const revealNodes = [...document.querySelectorAll('[data-reveal]')];
    if ('IntersectionObserver' in window) {
      const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      revealNodes.forEach((node) => revealObserver.observe(node));
    } else {
      revealNodes.forEach((node) => node.classList.add('is-visible'));
    }

    const progress = document.querySelector('[data-scroll-progress]');
    const scrollspy = document.querySelector('[data-scrollspy]');
    const spyItems = scrollspy ? [...scrollspy.querySelectorAll('a[href^="#"]')]
      .map((link) => ({ link, section: document.getElementById(link.hash.slice(1)), top: 0 }))
      .filter(({ section }) => section) : [];
    let frame = null;

    const measure = () => {
      spyItems.forEach((item) => { item.top = item.section.offsetTop; });
    };
    const renderScrollState = () => {
      frame = null;
      if (progress) {
        const maximum = Math.max(1, document.documentElement.scrollHeight - innerHeight);
        progress.style.setProperty('--vc-scroll-progress', String(Math.min(1, Math.max(0, scrollY / maximum))));
      }
      if (spyItems.length) {
        const marker = scrollY + innerHeight * 0.28;
        let current = spyItems[0];
        spyItems.forEach((item) => { if (item.top <= marker) current = item; });
        spyItems.forEach(({ link }) => {
          if (link === current.link) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      }
    };
    const queueScrollState = () => {
      if (frame) return;
      frame = requestAnimationFrame(renderScrollState);
    };
    const refresh = () => {
      measure();
      queueScrollState();
    };

    if (progress || spyItems.length) {
      addEventListener('scroll', queueScrollState, { passive: true });
      addEventListener('resize', refresh);
      addEventListener('hashchange', queueScrollState);
      addEventListener('load', refresh, { once: true });
      refresh();
    }
  };

  const start = () => {
    try { init(); }
    catch { root.classList.remove('vc-motion-ready'); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
