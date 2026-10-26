(function() {
  const q = window.painQueue, status = document.getElementById('pulseflowStatus');
  if (!q || !status) return;
  const policy = document.getElementById('pulseflowPolicy'), start = document.getElementById('pulseflowIndex'), stop = document.getElementById('pulseflowCancel');
  const ru = () => localStorage.getItem('pain_lang') === 'ru';
  try { const saved=localStorage.getItem('pain_pulseflow_policy');q.pulseflowPolicy=['smooth','contrast','personal'].includes(saved)?saved:'personal'; } catch (_) {}
  policy.value = q.pulseflowPolicy;
  policy.onchange = () => {
    q.pulseflowPolicy = policy.value; q.pulseflowPlan = null; q.cancelPendingSelection();
    try { localStorage.setItem('pain_pulseflow_policy', policy.value); } catch (_) {}
    window.dispatchEvent(new Event('pain:dj-changed'));
  };
  let busy = false;
  async function refresh(action = 'status') {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch('/api/pulseflow/' + action, action === 'status' ? {} : {
        method: 'POST', headers: { 'X-Pain-Update': 'pulseflow' }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'PulseFlow unavailable');
      const labels = ru() ? { empty: 'Нужен анализ фонотеки', loading: 'Загрузка CLAP', indexing: 'Анализ музыки', ready: 'Готово', interrupted: 'Анализ прерван — можно продолжить', error: 'Ошибка анализа', 'not-installed': 'Python-движок не установлен' }
        : { empty: 'Index the library', loading: 'Loading CLAP', indexing: 'Analyzing audio', ready: 'Ready', interrupted: 'Indexing interrupted — resume below', error: 'Indexing failed', 'not-installed': 'Python runtime is not installed' };
      status.textContent = `${labels[data.state] || data.state}: ${data.indexed || 0} / ${data.total || 0}`
        + (data.failed ? ` · ${ru() ? 'Ошибок' : 'Failed'}: ${data.failed}` : '')
        + (data.current ? ` · ${data.current}` : '') + (data.error || data.lastError ? ` · ${data.error || data.lastError}` : '');
      start.disabled = data.running || !data.installed; stop.hidden = !data.running;
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; }
  }
  start.onclick = () => refresh('index'); stop.onclick = () => refresh('cancel');
  refresh();
  setInterval(() => { if (!document.hidden && document.getElementById('view-settings')?.classList.contains('active')) refresh(); }, 3000);
})();
