// Page views for the public website only. No player events or music data.
if (location.hostname === 'pain-player.vercel.app' || location.hostname === 'painaudio.vercel.app') {
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  document.head.append(script);
}
