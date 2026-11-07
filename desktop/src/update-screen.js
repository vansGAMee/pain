/* Presentation only. Installation, playback and restart stay in the updater. */
(() => {
  'use strict';
  const screen = document.getElementById('updateScreen');
  const title = document.getElementById('updateScreenTitle');
  const detail = document.getElementById('updateScreenDetail');
  const progress = document.getElementById('updateScreenProgress');
  const version = document.getElementById('updateScreenVersion');
  const action = document.getElementById('updateScreenAction');
  const close = document.getElementById('updateScreenClose');
  const mini = document.createElement('button');
  mini.type = 'button';mini.className = 'update-mini';mini.hidden = true;
  mini.setAttribute('aria-haspopup', 'dialog');mini.setAttribute('aria-controls', screen.id);
  mini.innerHTML = '<span class="update-symbol" aria-hidden="true"><span class="update-orbit"><i></i><i></i></span><span class="update-leaf"></span></span><span><strong></strong><small></small></span>';
  document.getElementById('toastContainer').prepend(mini);
  let status, phase = '', ru = true;
  const text = (russian, english) => ru ? russian : english;

  function showMini() {mini.hidden = screen.open || phase !== 'downloading';}
  function open() {if (!screen.open) screen.showModal();showMini();}
  mini.addEventListener('click', open);
  close.addEventListener('click', () => screen.close());
  screen.addEventListener('close', showMini);
  screen.addEventListener('cancel', event => {if (phase === 'restarting') event.preventDefault();});
  action.addEventListener('click', () => document.getElementById('updateActionBtn').click());

  window.UpdateScreen = {
    open,
    render(next, {installing = false, lang = 'ru'} = {}) {
      status = next;ru = lang === 'ru';
      phase = installing && status?.status === 'downloaded' ? 'restarting' : status?.status || 'checking';
      screen.dataset.phase = phase;
      const busy = ['checking', 'downloading', 'restarting'].includes(phase);
      progress.hidden = !busy;
      progress.setAttribute('aria-label', text('Обновление PAIN', 'Updating PAIN'));
      action.hidden = true;close.hidden = phase === 'restarting';
      close.textContent = text('Вернуться к музыке', 'Back to music');
      version.textContent = status?.latestVersion && status.latestVersion !== status.currentVersion
        ? `${status.currentVersion || 'PAIN'} → ${status.latestVersion}` : status?.currentVersion || '';
      let heading, message;
      if (phase === 'checking') {
        heading = text('Проверяем обновления', 'Checking for updates');
        message = text('Ищем свежую версию PAIN.', 'Looking for the latest PAIN release.');
      } else if (phase === 'downloading') {
        heading = text('Обновляем PAIN', 'Updating PAIN');
        message = text('Загружаем и проверяем новую версию. Музыка продолжает играть.', 'Downloading and verifying the new version. Your music keeps playing.');
      } else if (phase === 'restarting') {
        heading = text('Всё готово. Перезапускаемся', 'All set. Restarting');
        message = text('PAIN откроется автоматически через несколько мгновений.', 'PAIN will reopen automatically in a few moments.');
      } else if (phase === 'error') {
        heading = text('Не удалось обновить PAIN', 'Could not update PAIN');
        message = text('Проверьте подключение к интернету и повторите проверку. Можно продолжать слушать музыку.', 'Check your internet connection and try again. You can keep listening to music.');
        action.hidden = false;action.textContent = text('Повторить проверку', 'Check again');
      } else if (status?.available) {
        heading = phase === 'downloaded' ? text('Обновление готово', 'Update ready') : text('Есть новая версия', 'A new version is available');
        message = phase === 'downloaded'
          ? text('Перезапустите PAIN сейчас или продолжайте слушать — обновление установится при выходе.', 'Restart PAIN now, or keep listening — the update will install when you quit.')
          : text('Обновите PAIN, когда будете готовы.', 'Update PAIN whenever you are ready.');
        action.hidden = false;action.textContent = document.getElementById('updateActionBtn').textContent;
      } else {
        heading = text('У вас свежая версия', 'You are up to date');
        message = text('Всё готово для вашей музыки.', 'Everything is ready for your music.');
        close.textContent = text('Продолжить', 'Continue');
      }
      title.textContent = heading;detail.textContent = message;
      mini.querySelector('strong').textContent = text('Обновляем PAIN', 'Updating PAIN');
      mini.querySelector('small').textContent = text('Можно продолжать слушать', 'Keep listening while we download');
      showMini();
    }
  };
})();
