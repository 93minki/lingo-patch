import { useRef, useState } from 'preact/hooks';
import { PROMPT_VERSION } from '../core/prompt/version';
import type { uiRequest } from '../messaging/extension';

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const BATCH_SIZE = 500;
const MAX_LINE_CHARS = 256_000;
const GZIP_MAGIC = [0x1f, 0x8b] as const;

type CacheExportHeader = {
  format: 1;
  promptVersion: number;
  exportedAt: number;
  count: number;
};

type ImportTotals = {
  imported: number;
  skipped: number;
  kept: number;
};

function formatExportDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function supportsGzipCompression(): boolean {
  return typeof CompressionStream !== 'undefined';
}

function supportsGzipDecompression(): boolean {
  return typeof DecompressionStream !== 'undefined';
}

async function readGzipMagic(file: File): Promise<boolean> {
  const head = file.slice(0, 2);
  const bytes = new Uint8Array(await head.arrayBuffer());
  return (
    bytes.length >= 2 &&
    bytes[0] === GZIP_MAGIC[0] &&
    bytes[1] === GZIP_MAGIC[1]
  );
}

function parseExportHeader(line: string): CacheExportHeader | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return undefined;
  const record = parsed as Record<string, unknown>;
  if (record.format !== 1) return undefined;
  return {
    format: 1,
    promptVersion:
      typeof record.promptVersion === 'number' &&
      Number.isFinite(record.promptVersion)
        ? record.promptVersion
        : -1,
    exportedAt:
      typeof record.exportedAt === 'number' &&
      Number.isFinite(record.exportedAt)
        ? record.exportedAt
        : 0,
    count:
      typeof record.count === 'number' &&
      Number.isFinite(record.count) &&
      record.count >= 0
        ? record.count
        : 0,
  };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildExportStream(
  request: typeof uiRequest,
  count: number,
): ReadableStream<BufferSource> {
  let after: string | undefined;
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      const header: CacheExportHeader = {
        format: 1,
        promptVersion: PROMPT_VERSION,
        exportedAt: Date.now(),
        count,
      };
      controller.enqueue(encoder.encode(`${JSON.stringify(header)}\n`));
    },
    async pull(controller) {
      try {
        const response = await request({
          type: 'cacheExportBatch',
          ...(after === undefined ? {} : { after }),
        });
        if (!response.ok || !response.entries) throw new Error('export-failed');
        const entries = response.entries;
        if (entries.length)
          controller.enqueue(
            encoder.encode(
              `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
            ),
          );
        after = entries.at(-1)?.key;
        if (entries.length < BATCH_SIZE) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

async function runImport(
  file: File,
  request: typeof uiRequest,
  confirmMismatch: (message: string) => boolean,
  onProgress?: (processedLines: number) => void,
): Promise<ImportTotals> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('file-too-large');
  }

  const isGzip = await readGzipMagic(file);
  if (isGzip && !supportsGzipDecompression()) {
    throw new Error('gzip-unsupported');
  }

  let stream: ReadableStream<BufferSource> = file.stream();
  if (isGzip) {
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }

  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let header: CacheExportHeader | undefined;
  let batch: unknown[] = [];
  let processedLines = 0;
  let discarding = false;
  const totals: ImportTotals = { imported: 0, skipped: 0, kept: 0 };

  const flush = async (finish: boolean) => {
    if (!header) throw new Error('missing-header');
    if (batch.length === 0 && !finish) return;
    const response = await request({
      type: 'cacheImportBatch',
      header,
      size: file.size,
      lines: batch,
      ...(finish ? { finish: true } : {}),
    });
    if (!response.ok) throw new Error('import-failed');
    batch = [];
    if (response.importResult) {
      totals.imported += response.importResult.imported;
      totals.skipped += response.importResult.skipped;
      totals.kept += response.importResult.kept;
    }
  };

  const pushLine = async (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!header) {
      const parsed = parseExportHeader(line);
      if (!parsed) throw new Error('invalid-header');
      if (parsed.promptVersion !== PROMPT_VERSION) {
        const proceed = confirmMismatch(
          `내보낸 파일의 promptVersion(${parsed.promptVersion})이 현재(${PROMPT_VERSION})와 다릅니다. 계속 가져올까요?`,
        );
        if (!proceed) throw new Error('prompt-cancelled');
      }
      header = parsed;
      return;
    }

    let parsed: unknown;
    try {
      parsed = line.length <= MAX_LINE_CHARS ? JSON.parse(line) : null;
    } catch {
      parsed = null;
    }
    batch.push(parsed);
    processedLines += 1;
    onProgress?.(processedLines);

    if (batch.length >= BATCH_SIZE) {
      await flush(false);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (typeof value === 'string' && value.length > 0) {
      if (discarding) {
        const end = value.indexOf('\n');
        if (end < 0) {
          if (done) await pushLine('');
          continue;
        }
        await pushLine('');
        discarding = false;
        buffer += value.slice(end + 1);
      } else buffer += value;
    }

    if (buffer.length > MAX_LINE_CHARS) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) {
        if (!header) throw new Error('invalid-header');
        buffer = '';
        discarding = true;
      }
    }

    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      await pushLine(line);
      newline = buffer.indexOf('\n');
    }

    if (done) {
      if (discarding) await pushLine('');
      if (buffer.length > 0) await pushLine(buffer);
      break;
    }
  }

  if (!header) throw new Error('invalid-header');
  await flush(true);
  return totals;
}

function errorMessage(code: string): string {
  switch (code) {
    case 'file-too-large':
      return '파일 크기는 50MB를 넘을 수 없습니다.';
    case 'gzip-unsupported':
      return 'gzip 파일을 풀 수 없습니다. 이 브라우저는 DecompressionStream을 지원하지 않습니다.';
    case 'invalid-header':
      return '캐시 파일 헤더가 올바르지 않습니다. format이 1인지 확인하세요.';
    case 'line-too-long':
      return '한 줄이 너무 깁니다. 손상되었거나 지원하지 않는 파일일 수 있습니다.';
    case 'prompt-cancelled':
      return '가져오기를 취소했습니다.';
    case 'export-failed':
    case 'import-failed':
      return '요청에 실패했습니다. 잠시 후 다시 시도하세요.';
    default:
      return '처리 중 오류가 발생했습니다.';
  }
}

export function CacheTransfer(props: {
  uiRequest: typeof uiRequest;
  confirm: (message: string) => boolean;
  onComplete?: () => void;
}) {
  const { uiRequest: request, confirm, onComplete } = props;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<ImportTotals | undefined>();

  const runExport = async () => {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setStatus('캐시를 내보내는 중…');
    try {
      const usage = await request({ type: 'cacheUsage' });
      if (!usage.ok || !usage.usage) throw new Error('export-failed');
      const count = usage.usage.count;
      const stamp = formatExportDate();
      const stream = buildExportStream(request, count);
      if (supportsGzipCompression()) {
        const blob = await new Response(
          stream.pipeThrough(new CompressionStream('gzip')),
        ).blob();
        downloadBlob(blob, `lingo-patch-cache-${stamp}.jsonl.gz`);
      } else {
        downloadBlob(
          await new Response(stream).blob(),
          `lingo-patch-cache-${stamp}.jsonl`,
        );
      }
      setStatus(`캐시 ${count}개 항목을 내보냈습니다.`);
      onComplete?.();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'unknown';
      setError(errorMessage(code));
      setStatus(undefined);
    } finally {
      setBusy(false);
    }
  };

  const runImportFromFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setStatus('캐시 파일을 읽는 중…');
    try {
      const totals = await runImport(file, request, confirm, (lines) =>
        setStatus(`가져오는 중… (${lines}줄 처리)`),
      );
      setResult(totals);
      setStatus(
        `가져옴 ${totals.imported} · 건너뜀 ${totals.skipped} · 기존 유지 ${totals.kept}`,
      );
      onComplete?.();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'unknown';
      setError(errorMessage(code));
      setStatus(undefined);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div class="cache-transfer" aria-label="캐시 내보내기 및 가져오기">
      <p class="options__hint">
        JSONL 형식으로 번역 캐시를 백업하거나 복원합니다. gzip을 지원하는
        환경에서는 .jsonl.gz로 내보냅니다.
      </p>
      <div class="options__row">
        <button
          type="button"
          class="options__btn"
          disabled={busy}
          aria-label="번역 캐시 내보내기"
          onClick={() => void runExport()}
        >
          내보내기
        </button>
        <button
          type="button"
          class="options__btn"
          disabled={busy}
          aria-label="번역 캐시 가져오기"
          onClick={() => fileInputRef.current?.click()}
        >
          가져오기
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jsonl,.jsonl.gz,.gz,application/gzip,application/x-ndjson"
          hidden
          aria-hidden="true"
          disabled={busy}
          onChange={(event) => {
            const input = event.currentTarget as HTMLInputElement;
            const file = input.files?.[0];
            void runImportFromFile(file);
          }}
        />
      </div>
      {busy && status ? (
        <p class="options__notice" role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
      {!busy && status ? (
        <p class="options__success" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p class="options__error" role="alert">
          {error}
        </p>
      ) : null}
      {!busy && result ? (
        <p class="options__hint" aria-label="가져오기 결과">
          가져옴 {result.imported} · 건너뜀 {result.skipped} · 기존 유지{' '}
          {result.kept}
        </p>
      ) : null}
    </div>
  );
}
