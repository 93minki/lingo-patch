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
import { createFixedBarFilter } from './fixed-bars';
import { isContentPing } from '../messaging/content-ping';
import type { GlossaryEntry } from '../core/glossary/types';
import { createSelectionOverlay } from './selection-overlay';
import { deserialize } from '../core/segment';

declare global {
  interface Window {
    __lpPipelineDispose?: () => void;
  }
}

export function startPagePipeline() {
  window.__lpPipelineDispose?.();
  const renderer = new SegmentRenderer(document);
  let records: RenderRecord[] = [];
  const memory = new Map<string, string>();
  const requested = new Set<string>();
  const everRequested = new Set<string>();
  const restored = new Set<string>();
  const translated = new Set<string>();
  let error: ProviderError['kind'] | 'unconfigured' | undefined;
  let configured = false;
  let glossary: GlossaryEntry[] = [];
  let selectionTranslation = true;
  const selectionRequests = new Map<string, string>();
  let skipFixedBars = true;
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
  // Hash-only changes (docs sites update #section while scrolling) are the same page.
  const pageUrl = () => location.origin + location.pathname + location.search;
  let href = pageUrl();
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let intersection: IntersectionObserver | undefined;
  let scanning = false,
    scanAgain = false;
  let started = false;
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
    const excluded = createFixedBarFilter(document);
    const keys = [
      ...new Set(
        await Promise.all(
          findSegments(document.body, { targetLang })
            .filter((segment) => !skipFixedBars || !excluded(segment.block))
            .map((segment) =>
              makeCacheKey({
                markup: segment.markup,
                targetLang,
                promptVersion: PROMPT_VERSION,
                glossary,
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
      const excluded = createFixedBarFilter(document);
      const segments = findSegments(document.body, { targetLang }).filter(
        (segment) => !skipFixedBars || !excluded(segment.block),
      );
      const keyed = await Promise.all(
        segments.map(async (segment) => ({
          segment,
          key: await makeCacheKey({
            markup: segment.markup,
            targetLang,
            promptVersion: PROMPT_VERSION,
            glossary,
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
    selectionRequests.clear();
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
      const wasConfigured = configured;
      const firstMode = lastAuto === undefined;
      const fixedChanged = skipFixedBars !== message.skipFixedBars;
      const revisionChanged = message.revision !== lastRevision;
      const glossaryChanged =
        JSON.stringify(glossary) !== JSON.stringify(message.glossary ?? []);
      glossary = message.glossary ?? [];
      skipFixedBars = message.skipFixedBars;
      configured = message.configured;
      selectionTranslation = message.selectionTranslation !== false;
      const changed = message.targetLang !== targetLang;
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
      if (!wasConfigured && configured && error === 'unconfigured') {
        error = undefined;
        report();
      }
      if (firstMode || changed || enabled !== wasEnabled)
        reset(wasEnabled && !enabled);
      else if (!wasConnected || revisionChanged) {
        for (const key of requested) everRequested.delete(key);
        requested.clear();
        if (!wasConnected) post({ type: 'reset' });
        if (enabled) {
          const keys = [...new Set(records.map((record) => record.key))];
          post({ type: 'page', pageId: pageId(), keys });
          post({ type: 'lookup', keys });
          report();
          scheduleScan(0);
        } else void inspect().catch(() => {});
      }
      if (
        (fixedChanged || glossaryChanged) &&
        !firstMode &&
        !changed &&
        enabled === wasEnabled
      ) {
        if (enabled) scheduleScan(0);
        else void inspect().catch(() => {});
      }
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
    if (message.type === 'cached') {
      for (const key of message.keys) {
        const markup = selectionRequests.get(key);
        if (markup === undefined) continue;
        const found = message.entries.find((entry) => entry.key === key);
        if (found) finishSelection(key, found.text);
        else
          post({
            type: 'translate',
            items: [{ key, markup, priority: 2 }],
          });
      }
    } else if (message.type === 'translated')
      finishSelection(message.key, message.text);
    else if (message.type === 'failed' && selectionRequests.has(message.key)) {
      selectionOverlay.showResult('번역하지 못했습니다.');
      selectionRequests.delete(message.key);
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
  const reconnectPort = () => {
    if (disposed) return;
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    const previous = port;
    port = undefined;
    connected = false;
    previous?.disconnect();
    connect();
  };
  const selectionOverlay = createSelectionOverlay(document, (text) => {
    const markup = text
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;');
    void requestSelection(markup);
  });
  function finishSelection(key: string, text: string) {
    if (!selectionRequests.has(key)) return;
    memory.set(key, text);
    selectionOverlay.showResult(
      deserialize(text, [], document).fragment.textContent ?? '',
    );
    selectionRequests.delete(key);
  }
  async function requestSelection(markup: string) {
    if (!connected || !configured) {
      selectionOverlay.showResult('번역 설정을 확인하세요.');
      if (!configured) {
        error = 'unconfigured';
        report();
      }
      return;
    }
    const epoch = generation;
    const key = await makeCacheKey({
      markup,
      targetLang,
      promptVersion: PROMPT_VERSION,
      glossary,
    });
    if (disposed || generation !== epoch) return;
    selectionRequests.set(key, markup);
    if (memory.has(key)) finishSelection(key, memory.get(key)!);
    else post({ type: 'lookup', keys: [key] });
  }
  const onSelection = (event: MouseEvent) => {
    if (
      !selectionTranslation ||
      !(event.target instanceof Element) ||
      event.target.closest(
        'input,textarea,select,[contenteditable],lp-t,lp-selection-overlay',
      )
    )
      return;
    const selection = document.getSelection();
    const text = selection?.toString().trim() ?? '';
    if (
      !text ||
      text.length > 2000 ||
      !selection?.rangeCount ||
      selection.anchorNode?.parentElement?.closest(
        '[contenteditable],input,textarea',
      )
    ) {
      selectionOverlay.hide();
      return;
    }
    selectionOverlay.showButton(
      text,
      selection.getRangeAt(0).getBoundingClientRect(),
    );
  };
  document.addEventListener('mouseup', onSelection);
  const connect = () => {
    if (disposed || !started) return;
    try {
      const current = browser.runtime.connect({ name: 'lp-page' });
      port = current;
      current.onMessage.addListener((message) => {
        if (port === current) receive(message);
      });
      current.onDisconnect.addListener(() => {
        if (port !== current) return;
        port = undefined;
        connected = false;
        if (!disposed && started) reconnectTimer = setTimeout(connect, 100);
      });
    } catch {
      if (!disposed && started) reconnectTimer = setTimeout(connect, 1000);
    }
  };
  const begin = () => {
    if (disposed || started) return;
    started = true;
    connect();
  };
  const onPageshow = (event: PageTransitionEvent) => {
    if (event.persisted && started && !connected && !disposed) reconnectPort();
  };
  const onPrerenderingChange = () => begin();
  const onPing = (
    message: unknown,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response: { ok: boolean }) => void,
  ) => {
    if (!isContentPing(message)) return;
    reconnectPort();
    sendResponse({ ok: true });
    return true;
  };
  const navigate = () => {
    if (pageUrl() !== href) {
      href = pageUrl();
      // A manual toggle applies to one page; the next page follows the site setting.
      enabled = Boolean(lastAuto);
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
  window.addEventListener('pageshow', onPageshow);
  browser.runtime.onMessage.addListener(onPing);
  if ('prerendering' in document && document.prerendering) {
    document.addEventListener('prerenderingchange', onPrerenderingChange, {
      once: true,
    });
  } else {
    begin();
  }
  const dispose = () => {
    disposed = true;
    clear();
    progress.destroy();
    port?.disconnect();
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
    if (routeTimer) clearInterval(routeTimer);
    clearInterval(heartbeat);
    navigation?.removeEventListener('navigatesuccess', navigate);
    window.removeEventListener('popstate', navigate);
    window.removeEventListener('pageshow', onPageshow);
    document.removeEventListener('prerenderingchange', onPrerenderingChange);
    browser.runtime.onMessage.removeListener(onPing);
    document.removeEventListener('mouseup', onSelection);
    selectionOverlay.destroy();
    if (window.__lpPipelineDispose === dispose)
      delete window.__lpPipelineDispose;
  };
  window.__lpPipelineDispose = dispose;
  return dispose;
}
