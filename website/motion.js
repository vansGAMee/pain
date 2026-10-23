/* Small compositor-only movements; no scroll loop or animation dependency. */
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  const toggle = document.querySelector('.motion-toggle');
  const animations = new Set();
  const previews = new Map();
  const ease = 'cubic-bezier(.22,1,.36,1)';
  let selected = true;
  try { selected = localStorage.getItem('pain_site_motion') !== 'off'; } catch (_) {}
  const enabled = () => selected && !preference.matches;

  function animate(element, frames, options = {}, cleanup = () => {}) {
    if (!enabled() || !element?.animate) { cleanup(); return null; }
    const animation = element.animate(frames, { duration: 700, easing: ease, ...options });
    animations.add(animation);
    const done = () => { animations.delete(animation); cleanup(); };
    animation.finished.then(done, done);
    return animation;
  }

  function update() {
    root.classList.toggle('motion-disabled', !enabled());
    root.classList.toggle('motion-away', document.hidden);
    if (toggle) {
      toggle.hidden = preference.matches;
      toggle.setAttribute('aria-pressed', String(enabled()));
      const label = enabled() ? 'Остановить движение' : 'Включить движение';
      toggle.setAttribute('aria-label', label); toggle.title = label;
      toggle.querySelector('path').setAttribute('d', enabled() ? 'M4 2v8M8 2v8' : 'M3 2l6 4-6 4z');
    }
    if (!enabled() || document.hidden) for (const animation of animations) animation.cancel();
  }
  update();
  toggle?.addEventListener('click', () => {
    selected = !selected;
    try { localStorage.setItem('pain_site_motion', selected ? 'on' : 'off'); } catch (_) {}
    update();
  });
  preference.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);

  // Existing image stays visible while its replacement loads; then only opacity changes.
  function swapImage(image, source) {
    previews.get(image)?.cancel();
    image.parentElement.querySelectorAll('.preview-previous').forEach(node => node.remove());
    if (!enabled() || image.src === new URL(source, location.href).href) { image.src = source; return; }
    const old = image.cloneNode(); old.removeAttribute('id'); old.alt = ''; old.setAttribute('aria-hidden', 'true');
    old.classList.add('preview-previous');
    Object.assign(old.style, { position: 'absolute', left: image.offsetLeft + 'px', top: image.offsetTop + 'px', width: image.offsetWidth + 'px', height: image.offsetHeight + 'px', pointerEvents: 'none', zIndex: '2' });
    image.parentElement.append(old); image.src = source;
    let fade;
    fade = animate(old, [{ opacity: 1 }, { opacity: 0 }], { duration: 360 }, () => {
      old.remove(); if (previews.get(image) === fade) previews.delete(image);
    });
    if (fade) previews.set(image, fade);
  }
  window.PainMotion = { enabled, animate, swapImage };

  const ambient = document.querySelectorAll('.object-stage, .sound-study');
  if ('IntersectionObserver' in window) {
    const activity = new IntersectionObserver(entries => {
      for (const entry of entries) entry.target.classList.toggle('is-active', entry.isIntersecting);
    });
    ambient.forEach(element => activity.observe(element));
    const entrance = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        entrance.unobserve(entry.target);
        animate(entry.target, [{ opacity: .25, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }]);
      }
    }, { threshold: .12 });
    document.querySelectorAll('.document-screen').forEach(element => entrance.observe(element));
  }
  for (const [i, element] of [...document.querySelectorAll('.hero-intro > *, .document-hero > *')].entries()) {
    animate(element, [{ opacity: .2, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 850, delay: i * 65 });
  }

  const hero = document.querySelector('.hero');
  const rim = document.querySelector('.record-rim');
  if (hero && rim && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let frame = 0, x = 0, y = 0;
    hero.addEventListener('pointermove', event => {
      if (!enabled() || document.hidden || event.pointerType === 'touch') return;
      const bounds = hero.getBoundingClientRect();
      x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
      y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (enabled() && !document.hidden) {
          rim.style.setProperty('--drift-x', (x * 5).toFixed(2) + 'px');
          rim.style.setProperty('--drift-y', (y * 4).toFixed(2) + 'px');
        }
      });
    }, { passive: true });
    hero.addEventListener('pointerleave', () => {
      cancelAnimationFrame(frame); frame = 0;
      rim.style.setProperty('--drift-x', '0px'); rim.style.setProperty('--drift-y', '0px');
    });
  }
})();
