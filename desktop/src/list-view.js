/* Stable, batched DOM updates. Presentation only; never changes track order/data. */
(function () {
  'use strict';
  function cancel(container) {
    if (container._renderFrame != null) cancelAnimationFrame(container._renderFrame);
    container._renderFrame = null;
  }

  function rememberScroll(container, nodes, keys) {
    if (!container.getClientRects().length) return [];
    const positions = [];
    for (let parent = container; parent; parent = parent.parentElement) {
      if (!parent.clientHeight || !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) continue;
      const bounds = parent.getBoundingClientRect();
      // Rows/cards follow visual order. Locate the viewport in logarithmic time
      // instead of measuring thousands of rows above it on every refresh.
      let low=0,high=nodes.length;
      while(low<high){const mid=(low+high)>>>1;if(nodes[mid].getBoundingClientRect().bottom<=bounds.top)low=mid+1;else high=mid;}
      let anchor;
      for(let i=low;i<nodes.length;i++){
        const node=nodes[i],rect=node.getBoundingClientRect();
        if(rect.top>=bounds.bottom)break;
        if(keys.has(node._listKey)&&rect.bottom>bounds.top){anchor=node;break;}
      }
      positions.push({parent, top: parent.scrollTop, key: anchor?._listKey,
        offset: anchor ? anchor.getBoundingClientRect().top - bounds.top : 0});
    }
    return positions;
  }

  function commit(container, nodes, update) {
    const old = [...container.children];
    const changed = old.length !== nodes.length || old.some((node, i) => node !== nodes[i]);
    const byKey = new Map(nodes.map(node => [node._listKey, node]));
    const scroll = changed ? rememberScroll(container, old, byKey) : [];
    const focused = document.activeElement;
    const focusRow = changed && old.find(node => node.contains(focused));
    const controls = 'button,input,select,a,[tabindex]';
    const focusIndex = focusRow ? [...focusRow.querySelectorAll(controls)].indexOf(focused) : -1;
    if (changed) {
      // Keep existing nodes connected. A refresh never exposes an empty list.
      let cursor = container.firstElementChild;
      for (const node of nodes) {
        if (node === cursor) cursor = cursor.nextElementSibling;
        else container.insertBefore(node, cursor);
      }
      const retained = new Set(nodes);
      for (const node of old) if (!retained.has(node)) node.remove();
    }
    if (update) nodes.forEach(update);
    if (focusRow && document.activeElement !== focused) {
      const row = byKey.get(focusRow._listKey);
      const target = focusRow === focused ? row : row?.querySelectorAll(controls)[focusIndex];
      target?.focus({preventScroll: true});
    }
    for (const {parent, top, key, offset} of scroll) {
      const anchor = byKey.get(key);
      const next = anchor ? parent.scrollTop + anchor.getBoundingClientRect().top
        - parent.getBoundingClientRect().top - offset : top;
      if (Math.abs(parent.scrollTop - next) > .5) parent.scrollTop = next;
    }
  }

  function render(container, items, options) {
    cancel(container);
    if (items.length > 160 || container._windowedList) {
      container._windowedList ||= PainWindowedList.attach(container);
      container._windowedList.setItems(items, options);
      return;
    }
    const {key, signature, create, update, complete, empty} = options;
    const previous = new Map([...container.children].map(node => [node._listKey, node]));
    const initial = !container.children.length || (items.length>0 && [...container.children].every(node=>node._listKey===undefined));
    if(initial)container.replaceChildren();
    const nodes = [];
    let index = 0;
    function batch() {
      container._renderFrame = null;
      const start = performance.now(), fragment = document.createDocumentFragment();
      let count = 0;
      while (index < items.length) {
        const item = items[index], id = key(item), stamp = signature(item, index);
        let node = previous.get(id);
        if (!node || node._listSignature !== stamp) { node = create(item, index);count++; }
        node._listKey = id;node._listSignature = stamp;
        nodes.push(node);
        if (initial) fragment.appendChild(node);
        index++;
        if (count >= 24 || performance.now() - start >= 3) break;
      }
      // Initial paint remains incremental. Updates prepare changes off-screen
      // and commit together, so slow CPUs cannot clamp scroll between batches.
      if (initial) container.appendChild(fragment);
      if (index < items.length) container._renderFrame = requestAnimationFrame(batch);
      else {
        if (!nodes.length && empty) nodes.push(empty());
        commit(container, nodes, update);
        complete?.();
      }
    }
    batch();
  }
  window.PainListView = {render, cancel};
})();
