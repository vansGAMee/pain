/* Keep the complete collection in the caller; mount only the viewport and a
 * buffer. Geometry comes from actual rows/cards, including fonts and themes. */
(() => {
  'use strict';
  const controls = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]';

  function attach(container) {
    const viewport = container.closest('.views-viewport');
    const table = container.tagName === 'TBODY';
    const itemSelector = table ? 'tr[data-track-id]' : '.track-card[data-track-id]';
    let items = [], options, keys = [], indexByKey = new Map();
    let columns = 1, gap = 0, width = 0, estimate = table ? 60 : 260;
    let rowKeys = [], offsets = [0], sizes = new Map(), bootstrap = true;
    let start = -1, end = -1, dragging = null, invalidated = true, layoutKey;
    let painted = false, stableAnchor = null, tableColumns = 7;
    container.classList.add('windowed-list');
    if (!table) container.setAttribute('role', 'list');

    const visible = () => container.getClientRects().length > 0;
    const innerTop = () => viewport.getBoundingClientRect().top + viewport.clientTop;
    const listTop = () => container.getBoundingClientRect().top - innerTop() + viewport.scrollTop;
    const rows = () => Math.ceil(items.length / columns);

    function anchor(allowed = indexByKey) {
      if (!visible()) return null;
      const top = innerTop(), bottom = top + viewport.clientHeight;
      for (const node of container.children) {
        if (node._listKey === undefined || !allowed.has(node._listKey)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.bottom > top && rect.top < bottom) return {key: node._listKey, offset: rect.top - top};
      }
      return null;
    }

    function rebuild() {
      rowKeys = [];offsets = [0];
      for (let i = 0; i < items.length; i += columns) {
        const key = JSON.stringify(keys.slice(i, i + columns));
        rowKeys.push(key);
        offsets.push(offsets.at(-1) + (sizes.get(key) ?? estimate) + gap);
      }
    }

    function rowAt(y) {
      let low = 0, high = rows();
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (offsets[mid + 1] <= y) low = mid + 1;else high = mid;
      }
      return Math.min(Math.max(0, rows() - 1), low);
    }

    function spacer(from, to, ordinal, previous) {
      let node = previous[ordinal];
      if (!node) {
        node = document.createElement(table ? 'tr' : 'div');
        node.className = 'list-window-spacer';node.setAttribute('aria-hidden', 'true');
        if (table) node.appendChild(document.createElement('td'));
      }
      if (table) node.firstElementChild.colSpan = tableColumns;
      const target = table ? node.firstElementChild : node;
      const height = Math.max(0, offsets[to] - offsets[from] - gap) + 'px';
      if (target.style.height !== height) target.style.height = height;
      return node;
    }

    function writeWindow(from, to) {
      const old = [...container.children];
      const previous = new Map(old.filter(n => n._listKey !== undefined).map(n => [n._listKey, n]));
      const spacers = old.filter(n => n.classList.contains('list-window-spacer'));
      const focused = document.activeElement, focusRow = focused?.closest(itemSelector);
      const focusKey = container.contains(focusRow) ? focusRow._listKey : null;
      const focusIndex = focusKey == null ? -1 : [...focusRow.querySelectorAll(controls)].indexOf(focused);
      const ranges = [[from, to]];
      // Retain a focused control or drag source without mounting all the rows
      // between it and a distant scroll position.
      for (const key of [focusKey, dragging]) {
        const index = indexByKey.get(key);
        if (index !== undefined) {const row = Math.floor(index / columns);ranges.push([row, row + 1]);}
      }
      ranges.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const range of ranges) {
        const last = merged.at(-1);
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);else merged.push(range.slice());
      }
      const nodes = [];let cursorRow = 0, spacerIndex = 0;
      for (const [a, b] of merged) {
        if (a > cursorRow) nodes.push(spacer(cursorRow, a, spacerIndex++, spacers));
        for (let i = a * columns; i < Math.min(items.length, b * columns); i++) {
          const key = keys[i], signature = options.signature(items[i], i);
          let node = previous.get(key);
          if (!node || node._listSignature !== signature) node = options.create(items[i], i);
          node._listKey = key;node._listSignature = signature;node._windowIndex = i;
          if (table) node.setAttribute('aria-rowindex', i + 2);
          else {node.setAttribute('role', 'listitem');node.setAttribute('aria-posinset', i + 1);node.setAttribute('aria-setsize', items.length);}
          options.update?.(node, i);nodes.push(node);
        }
        cursorRow = b;
      }
      if (cursorRow < rows()) nodes.push(spacer(cursorRow, rows(), spacerIndex, spacers));
      let cursor = container.firstElementChild;
      for (const node of nodes) {
        if (node === cursor) cursor = cursor.nextElementSibling;else container.insertBefore(node, cursor);
      }
      const retained = new Set(nodes);
      for (const node of old) if (!retained.has(node)) node.remove();
      if (focusKey != null && document.activeElement !== focused) {
        const row = nodes.find(n => n._listKey === focusKey);
        row?.querySelectorAll(controls)[focusIndex]?.focus({preventScroll: true});
      }
      start = from;end = to;painted = true;
    }

    function restore(saved) {
      if (!saved) return;
      const node = [...container.children].find(n => n._listKey === saved.key);
      if (node) {
        const delta = node.getBoundingClientRect().top - innerTop() - saved.offset;
        if (Math.abs(delta) > .5) viewport.scrollTop += delta;
      }
    }

    function draw(force = false, saved = null) {
      if (!options || !visible()) {stableAnchor = null;return;}
      if (!items.length) {
        if (force || !painted) container.replaceChildren(...(options.empty ? [options.empty()] : []));
        painted = true;stableAnchor = null;start = end = 0;options.complete?.();return;
      }
      const style = getComputedStyle(container), nextWidth = container.getBoundingClientRect().width;
      const nextColumns = table ? 1 : Math.max(1, style.gridTemplateColumns.split(/\s+/).length);
      const nextGap = table ? 0 : parseFloat(style.rowGap) || 0;
      if (invalidated || Math.abs(nextWidth - width) > .5 || columns !== nextColumns || gap !== nextGap) {
        // ResizeObserver runs after the browser has already reflowed the grid.
        // Remember the song from the preceding layout, not a shifted neighbour.
        saved ||= stableAnchor && indexByKey.has(stableAnchor.key) ? stableAnchor : anchor();
        columns = nextColumns;gap = nextGap;width = nextWidth;
        if (table) tableColumns = [...container.closest('table').tHead.rows[0].cells].filter(cell => getComputedStyle(cell).display !== 'none').length;
        sizes.clear();bootstrap = true;invalidated = false;rebuild();force = true;
      }
      let top = viewport.scrollTop - listTop();
      if (saved && indexByKey.has(saved.key)) top = offsets[Math.floor(indexByKey.get(saved.key) / columns)] - saved.offset;
      const height = viewport.clientHeight, first = rowAt(top), last = rowAt(top + height) + 1;
      if (!force && first >= start + (start > 0 ? 3 : 0) && last <= end - (end < rows() ? 3 : 0)) {stableAnchor = anchor();return;}
      const buffer = Math.max(height, estimate * 5);
      const from = rowAt(Math.max(0, top - buffer)), to = Math.min(rows(), rowAt(top + height + buffer) + 1);
      saved ||= anchor();
      writeWindow(from, to);
      // One measurement pass over the mounted window, never over the collection.
      const measured = new Map();
      for (const node of container.children) if (node._listKey !== undefined) {
        const row = Math.floor(node._windowIndex / columns), h = node.getBoundingClientRect().height;
        measured.set(row, Math.max(measured.get(row) || 0, h));
      }
      let changed = false;
      if (bootstrap && measured.size) {estimate = measured.values().next().value;bootstrap = false;changed = true;}
      for (const [row, h] of measured) {
        if (h > 0 && Math.abs((sizes.get(rowKeys[row]) ?? estimate) - h) > .1) changed = true;
        sizes.set(rowKeys[row], h);
      }
      if (changed) {rebuild();writeWindow(from, to);}
      restore(saved);
      stableAnchor = anchor();
      options.complete?.();
    }

    function schedule(force = false) {
      if (force) invalidated = true;
      if (container._renderFrame != null) return;
      container._renderFrame = requestAnimationFrame(() => {container._renderFrame = null;draw();});
    }

    function reveal(index) {
      if (index < 0 || index >= items.length || !visible()) return;
      const row = Math.floor(index / columns), top = listTop() + offsets[row], bottom = top + (sizes.get(rowKeys[row]) ?? estimate);
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = bottom - viewport.clientHeight;
      draw(true);
    }

    viewport.addEventListener('scroll', () => schedule(), {passive: true});
    container.addEventListener('focusout', () => {start = end = -1;schedule();});
    container.addEventListener('dragstart', event => {dragging = event.target.closest(itemSelector)?._listKey ?? null;});
    container.addEventListener('dragend', () => {dragging = null;start = end = -1;schedule();});
    container.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
      const row = event.target.closest(itemSelector);if (!row || !container.contains(row)) return;
      const buttons = [...row.querySelectorAll(controls)].filter(n => n.getClientRects().length);
      if (event.target !== (event.shiftKey ? buttons[0] : buttons.at(-1))) return;
      const index = indexByKey.get(row._listKey) + (event.shiftKey ? -1 : 1);
      if (index < 0 || index >= items.length) return;
      event.preventDefault();reveal(index);
      const next = [...container.children].find(n => n._listKey === keys[index]);
      const nextButtons = [...(next?.querySelectorAll(controls) || [])].filter(n => n.getClientRects().length);
      (event.shiftKey ? nextButtons.at(-1) : nextButtons[0])?.focus({preventScroll: true});
    });
    let observedWidth = 0, observedHeight = 0;
    new ResizeObserver(() => {
      if (!visible()) return;
      const w = container.getBoundingClientRect().width, h = viewport.clientHeight;
      if (w !== observedWidth || h !== observedHeight) {observedWidth = w;observedHeight = h;schedule();}
    }).observe(viewport);
    // Side panel/font changes can resize the grid without a window resize.
    new ResizeObserver(() => {if (visible() && Math.abs(container.getBoundingClientRect().width - width) > .5) schedule();}).observe(container);
    window.addEventListener('pain:view', () => schedule());
    window.addEventListener('pain:theme', () => schedule(true));
    new MutationObserver(() => schedule(true)).observe(document.documentElement, {attributes: true, attributeFilter: ['data-app-font']});
    document.fonts?.addEventListener('loadingdone', () => schedule(true));

    return {
      setItems(nextItems, nextOptions) {
        const nextKeys = nextItems.map(nextOptions.key), nextIndex = new Map(nextKeys.map((key, i) => [key, i]));
        const saved = anchor(nextIndex);
        items = nextItems;options = nextOptions;keys = nextKeys;indexByKey = nextIndex;
        if (layoutKey !== options.layoutKey) {layoutKey = options.layoutKey;invalidated = true;}
        if (table) container.closest('table').setAttribute('aria-rowcount', items.length + 1);
        rebuild();const retained = new Set(rowKeys);for (const key of sizes.keys()) if (!retained.has(key)) sizes.delete(key);
        draw(true, saved);
      },
      reveal
    };
  }
  window.PainWindowedList = {attach};
})();
