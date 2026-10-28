import { browser, type Browser } from 'wxt/browser';
import { findSegments } from '../core/segment';
import { makeCacheKey } from '../core/cache/key';
import { PROMPT_VERSION } from '../core/prompt/version';
import { uiRequest } from '../messaging/extension';
import type { ProviderError } from '../providers/types';
import { createProgress } from './progress';
import type { BackgroundMessage, PagePayload } from '../messaging/types';
import { SegmentRenderer, type RenderRecord } from './renderer';
import { ensureStyle } from './style';

export function startPagePipeline() {
  const renderer = new SegmentRenderer(document);
  let records: RenderRecord[] = [];
  const memory = new Map<string, string>();
  const requested = new Set<string>();
  const everRequested = new Set<string>();
  const restored = new Set<string>();
  const translated = new Set<string>();
  let error: ProviderError['kind'] | 'unconfigured' | undefined;
  let configured = false;
  let forceAll = false;
  const progress = createProgress(document, () => {
    void uiRequest({ type: 'openOptions' }).catch(() => {});
  });
  let port: Browser.runtime.Port | undefined;
  let enabled = false,
    disposed = false,
    connected = false;
  let generation = 0,
    targetLang = 'ko',
    lastRevision = -1,
    lastAuto: boolean | undefined;
  let href = location.href;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let intersection: IntersectionObserver | undefined;
  let scanning = false,
    scanAgain = false;
  const post = (message: PagePayload) => {
    try {
      port?.postMessage({ ...message, generation });
    } catch {
      /* Reconnect handler resumes outstanding work. */
    }
  };
  const report = () => {
    progress.update({
      requested: everRequested.size,
      completed: everRequested.size - requested.size,
      error,
    });
    post({
      type: 'status',
      enabled,
      total: new Set(records.map((record) => record.key)).size,
      restored: restored.size,
      translated: translated.size,
      pending: requested.size,
      error,
    });
  };
  const inspect = async () => {
    if (enabled) {
      post({
        type: 'page',
        pageId: pageId(),
        keys: [...new Set(records.map((record) => record.key))],
      });
      report();
      return;
    }
    const epoch = generation;
    const keys = [
      ...new Set(
        await Promise.all(
          findSegments(document.body, { targetLang }).map((segment) =>
            makeCacheKey({
              markup: segment.markup,
              targetLang,
              promptVersion: PROMPT_VERSION,
            }),
          ),
        ),
      ),
    ];
    if (epoch !== generation || disposed) return;
    post({ type: 'page', pageId: pageId(), keys });
    post({
      type: 'status',
      enabled,
      total: keys.length,
      restored: 0,
      translated: 0,
      pending: 0,
    });
  };
  const pageId = () => location.origin + location.pathname;
  const observeMissing = (keys: Set<string>) => {
    if (forceAll) {
      forceAll = false;
      const blocks = new Set(
        records
          .filter((record) => keys.has(record.key) && !memory.has(record.key))
          .map((record) => record.segment.block),
      );
      request(
        [...blocks].map(
          (block) =>
            ({
              target: block,
              isIntersecting: true,
              boundingClientRect: block.getBoundingClientRect(),
            }) as IntersectionObserverEntry,
        ),
      );
      return;
    }
    for (const record of records) {
      if (
        keys.has(record.key) &&
        !memory.has(record.key) &&
        !requested.has(record.key) &&
        !record.abandoned
      )
        intersection?.observe(record.segment.block);
    }
  };
  const request = (entries: IntersectionObserverEntry[]) => {
    const items: { key: string; markup: string; priority: number }[] = [];
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const rect = entry.boundingClientRect;
      for (const record of records) {
        if (
          record.segment.block !== entry.target ||
          memory.has(record.key) ||
          requested.has(record.key) ||
          record.abandoned
        )
          continue;
        if (!configured) {
          error = 'unconfigured';
          continue;
        }
        requested.add(record.key);
        everRequested.add(record.key);
        renderer.render(record, 'pending');
        items.push({
          key: record.key,
          markup: record.segment.markup,
          priority: rect.bottom > 0 && rect.top < innerHeight ? 2 : 1,
        });
      }
      intersection?.unobserve(entry.target);
    }
    report();
    if (items.length)
      post({
        type: 'translate',
        items,
        context: {
          pageTitle: document.title,
          section: document.querySelector('h1')?.textContent ?? undefined,
        },
      });
  };
  async function scan() {
    if (!enabled || !connected || disposed) return;
    if (scanning) {
      scanAgain = true;
      return;
    }
    scanning = true;
    const epoch = generation;
    try {
      const segments = findSegments(document.body, { targetLang });
      const keyed = await Promise.all(
        segments.map(async (segment) => ({
          segment,
          key: await makeCacheKey({
            markup: segment.markup,
            targetLang,
            promptVersion: PROMPT_VERSION,
          }),
        })),
      );
      if (epoch !== generation || !enabled || disposed) return;
      const next: RenderRecord[] = [];
      for (const { key, segment } of keyed) {
        const old = records.find(
          (record) =>
            record.key === key &&
            record.segment.block === segment.block &&
            record.segment.anchor === segment.anchor,
        );
        const record = old ?? renderer.create(key, segment);
        if (
          old &&
          segment.placeholders.some(
            (placeholder, index) =>
              placeholder.node !== old.segment.placeholders[index]?.node,
          )
        ) {
          renderer.remove(old);
        }
        record.segment = segment;
        next.push(record);
        if (memory.has(key)) renderer.render(record, 'ready', memory.get(key));
      }
      for (const old of records) if (!next.includes(old)) renderer.remove(old);
      records = next;
      const keys = [...new Set(records.map((record) => record.key))];
      post({ type: 'page', pageId: pageId(), keys });
      post({ type: 'lookup', keys });
      report();
    } finally {
      scanning = false;
      if (scanAgain) {
        scanAgain = false;
        scheduleScan();
      }
    }
  }
  const scheduleScan = (delay = 300) => {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = undefined;
      void scan().catch(() =>
        console.warn('lingo-patch: unable to scan this page'),
      );
    }, delay);
  };
  const mutations = new MutationObserver((changes) => {
    if (!enabled) return;
    let sourceChanged = false;
    for (const change of changes) {
      if (
        (change.target.nodeType === 1
          ? (change.target as Element)
          : change.target.parentElement
        )?.closest('lp-t')
      )
        continue;
      if (change.type === 'characterData') sourceChanged = true;
      else if (
        [...change.addedNodes, ...change.removedNodes].some(
          (node) =>
            node.nodeType !== 1 || (node as Element).localName !== 'lp-t',
        )
      )
        sourceChanged = true;
    }
    for (const record of records) renderer.restore(record);
    if (sourceChanged) scheduleScan();
  });
  const clear = () => {
    mutations.disconnect();
    intersection?.disconnect();
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = undefined;
    renderer.clear(records);
    records = [];
    requested.clear();
    memory.clear();
    everRequested.clear();
    restored.clear();
    translated.clear();
    error = undefined;
    progress.update({ requested: 0, completed: 0 });
  };
  const reset = (stop = false) => {
    clear();
    generation++;
    post({ type: 'reset', ...(stop ? { stop: true } : {}) });
    if (!connected) return;
    if (!enabled) {
      void inspect().catch(() => {});
      return;
    }
    ensureStyle(document);
    intersection = new IntersectionObserver(request, {
      rootMargin: `${innerHeight}px 0px ${innerHeight}px 0px`,
    });
    mutations.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    post({
      type: 'page',
      pageId: pageId(),
      keys: [],
      prefetch: true,
    });
    scheduleScan(0);
  };
  const receive = (message: BackgroundMessage) => {
    if (message.type === 'mode') {
      const wasEnabled = enabled;
      configured = message.configured;
      const changed =
        !connected ||
        message.targetLang !== targetLang ||
        message.revision !== lastRevision;
      if (lastAuto === undefined || lastAuto !== message.autoEnabled)
        enabled = message.autoEnabled;
      lastAuto = message.autoEnabled;
      targetLang = message.targetLang;
      lastRevision = message.revision;
      document.documentElement.setAttribute(
        'data-lp-mode',
        message.displayMode,
      );
      const wasConnected = connected;
      connected = true;
      if (changed || !wasConnected || enabled !== wasEnabled)
        reset(wasEnabled && !enabled);
      else if (!enabled) clear();
      return;
    }
    if (message.generation !== generation) return;
    if (message.type === 'inspect') {
      void inspect().catch(() => {});
      return;
    }
    if (message.type === 'retranslate') {
      forceAll = true;
      enabled = true;
      reset();
      return;
    }
    if (message.type === 'toggle') {
      enabled = !enabled;
      reset(!enabled);
      return;
    }
    if (!enabled) return;
    if (message.type === 'cached') {
      for (const entry of message.entries) {
        memory.set(entry.key, entry.text);
        if (!translated.has(entry.key)) restored.add(entry.key);
        requested.delete(entry.key);
        for (const record of records)
          if (record.key === entry.key)
            renderer.render(record, 'ready', entry.text);
      }
      if (!message.prefetch) observeMissing(new Set(message.keys));
    } else if (message.type === 'translated') {
      requested.delete(message.key);
      translated.add(message.key);
      restored.delete(message.key);
      memory.set(message.key, message.text);
      for (const record of records)
        if (record.key === message.key)
          renderer.render(record, 'ready', message.text);
    } else if (message.type === 'failed') {
      requested.delete(message.key);
      if (message.kind !== 'aborted') error = message.kind;
      for (const record of records)
        if (record.key === message.key) renderer.render(record, 'error');
    }
    report();
  };
  const connect = () => {
    if (disposed) return;
    try {
      port = browser.runtime.connect({ name: 'lp-page' });
      port.onMessage.addListener(receive);
      port.onDisconnect.addListener(() => {
        connected = false;
        requested.clear();
        if (!disposed) reconnectTimer = setTimeout(connect, 100);
      });
    } catch {
      if (!disposed) reconnectTimer = setTimeout(connect, 1000);
    }
  };
  const navigate = () => {
    if (location.href !== href) {
      href = location.href;
      reset();
    }
  };
  const navigation = (window as Window & { navigation?: EventTarget })
    .navigation;
  navigation?.addEventListener('navigatesuccess', navigate);
  if (!navigation) window.addEventListener('popstate', navigate);
  const routeTimer = navigation ? undefined : setInterval(navigate, 500);
  const heartbeat = setInterval(() => {
    if (enabled && requested.size) post({ type: 'lookup', keys: [] });
  }, 20000);
  connect();
  return () => {
    disposed = true;
    clear();
    progress.destroy();
    port?.disconnect();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (routeTimer) clearInterval(routeTimer);
    clearInterval(heartbeat);
    navigation?.removeEventListener('navigatesuccess', navigate);
    window.removeEventListener('popstate', navigate);
  };
}
