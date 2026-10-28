import { useEffect, useId, useMemo, useState } from 'preact/hooks';
import type { GlossaryEntry } from '../core/glossary/types';
import './glossary-editor.css';

export type GlossaryEditorValue = {
  global: GlossaryEntry[];
  sites: Record<string, GlossaryEntry[]>;
  useDefaults: boolean;
};

function normalizeHostname(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.includes('/') || trimmed.includes(':'))
    return undefined;
  if (trimmed.includes('://')) return undefined;
  return trimmed;
}

function newEntry(partial?: Partial<GlossaryEntry>): GlossaryEntry {
  return {
    term: '',
    mode: 'keep',
    caseSensitive: false,
    ...partial,
  };
}

type EntryScope = 'global' | 'site';

function entriesForScope(
  value: GlossaryEditorValue,
  scope: EntryScope,
  siteHost: string | undefined,
): GlossaryEntry[] {
  if (scope === 'global') return value.global;
  if (!siteHost) return [];
  return value.sites[siteHost] ?? [];
}

function setEntriesForScope(
  value: GlossaryEditorValue,
  scope: EntryScope,
  siteHost: string | undefined,
  entries: GlossaryEntry[],
): GlossaryEditorValue {
  if (scope === 'global') {
    return { ...value, global: entries };
  }
  if (!siteHost) return value;
  return {
    ...value,
    sites: { ...value.sites, [siteHost]: entries },
  };
}

type EntryTableProps = {
  scopeLabel: string;
  entries: GlossaryEntry[];
  idPrefix: string;
  onUpdate: (index: number, patch: Partial<GlossaryEntry>) => void;
  onRemove: (index: number) => void;
};

function EntryTable({
  scopeLabel,
  entries,
  idPrefix,
  onUpdate,
  onRemove,
}: EntryTableProps) {
  if (entries.length === 0) {
    return (
      <p class="glossary-editor__empty">
        {scopeLabel}에 등록된 항목이 없습니다.
      </p>
    );
  }

  return (
    <div class="glossary-editor__table-wrap">
      <table
        class="glossary-editor__table"
        aria-label={`${scopeLabel} 용어 목록`}
      >
        <thead>
          <tr>
            <th scope="col">용어</th>
            <th scope="col">방식</th>
            <th scope="col">번역어</th>
            <th scope="col">대소문자</th>
            <th scope="col">
              <span class="glossary-editor__visually-hidden">삭제</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const rowLabel = `${scopeLabel} ${index + 1}번째 항목`;
            const termId = `${idPrefix}-term-${index}`;
            const modeId = `${idPrefix}-mode-${index}`;
            const targetId = `${idPrefix}-target-${index}`;
            const caseId = `${idPrefix}-case-${index}`;
            return (
              <tr key={`${idPrefix}-${index}-${entry.term}`}>
                <td>
                  <label class="glossary-editor__visually-hidden" for={termId}>
                    {rowLabel} 용어
                  </label>
                  <input
                    id={termId}
                    type="text"
                    value={entry.term}
                    autocomplete="off"
                    aria-label={`${rowLabel} 용어`}
                    onInput={(event) =>
                      onUpdate(index, {
                        term: (event.currentTarget as HTMLInputElement).value,
                      })
                    }
                  />
                </td>
                <td>
                  <label class="glossary-editor__visually-hidden" for={modeId}>
                    {rowLabel} 방식
                  </label>
                  <select
                    id={modeId}
                    value={entry.mode}
                    aria-label={`${rowLabel} 방식`}
                    onChange={(event) => {
                      const mode = (event.currentTarget as HTMLSelectElement)
                        .value as GlossaryEntry['mode'];
                      onUpdate(index, {
                        mode,
                        ...(mode === 'keep' ? { target: undefined } : {}),
                      });
                    }}
                  >
                    <option value="keep">keep (원문 유지)</option>
                    <option value="map">map (번역어 지정)</option>
                  </select>
                </td>
                <td>
                  <label
                    class="glossary-editor__visually-hidden"
                    for={targetId}
                  >
                    {rowLabel} 번역어
                  </label>
                  <input
                    id={targetId}
                    type="text"
                    value={entry.target ?? ''}
                    disabled={entry.mode === 'keep'}
                    autocomplete="off"
                    aria-label={`${rowLabel} 번역어`}
                    placeholder={entry.mode === 'map' ? '번역어' : ''}
                    onInput={(event) =>
                      onUpdate(index, {
                        target: (event.currentTarget as HTMLInputElement).value,
                      })
                    }
                  />
                </td>
                <td>
                  <label class="glossary-editor__checkbox-label">
                    <input
                      id={caseId}
                      type="checkbox"
                      checked={entry.caseSensitive}
                      aria-label={`${rowLabel} 대소문자 구분`}
                      onChange={(event) =>
                        onUpdate(index, {
                          caseSensitive: (
                            event.currentTarget as HTMLInputElement
                          ).checked,
                        })
                      }
                    />
                    구분
                  </label>
                </td>
                <td>
                  <button
                    type="button"
                    class="glossary-editor__btn glossary-editor__btn--danger"
                    aria-label={`${rowLabel} 삭제`}
                    onClick={() => onRemove(index)}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type AddEntryFormProps = {
  scopeLabel: string;
  idPrefix: string;
  disabled?: boolean;
  onAdd: (entry: GlossaryEntry) => void;
};

function AddEntryForm({
  scopeLabel,
  idPrefix,
  disabled,
  onAdd,
}: AddEntryFormProps) {
  const [draft, setDraft] = useState<GlossaryEntry>(() => newEntry());

  const resetDraft = () => setDraft(newEntry());

  const submit = () => {
    const term = draft.term.trim();
    if (!term) return;
    const entry: GlossaryEntry = {
      term,
      mode: draft.mode,
      caseSensitive: draft.caseSensitive,
      ...(draft.mode === 'map' && draft.target?.trim()
        ? { target: draft.target.trim() }
        : {}),
    };
    onAdd(entry);
    resetDraft();
  };

  const termId = `${idPrefix}-add-term`;
  const modeId = `${idPrefix}-add-mode`;
  const targetId = `${idPrefix}-add-target`;
  const caseId = `${idPrefix}-add-case`;

  return (
    <div class="glossary-editor__add" aria-label={`${scopeLabel} 항목 추가`}>
      <h3>{scopeLabel} 항목 추가</h3>
      <div class="glossary-editor__add-grid">
        <div>
          <label for={termId}>용어</label>
          <input
            id={termId}
            type="text"
            value={draft.term}
            disabled={disabled}
            autocomplete="off"
            aria-label={`${scopeLabel} 추가 용어`}
            onInput={(event) =>
              setDraft((prev) => ({
                ...prev,
                term: (event.currentTarget as HTMLInputElement).value,
              }))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <div>
          <label for={modeId}>방식</label>
          <select
            id={modeId}
            value={draft.mode}
            disabled={disabled}
            aria-label={`${scopeLabel} 추가 방식`}
            onChange={(event) => {
              const mode = (event.currentTarget as HTMLSelectElement)
                .value as GlossaryEntry['mode'];
              setDraft((prev) => ({
                ...prev,
                mode,
                ...(mode === 'keep' ? { target: undefined } : prev),
              }));
            }}
          >
            <option value="keep">keep</option>
            <option value="map">map</option>
          </select>
        </div>
        <div>
          <label for={targetId}>번역어</label>
          <input
            id={targetId}
            type="text"
            value={draft.target ?? ''}
            disabled={disabled || draft.mode === 'keep'}
            autocomplete="off"
            aria-label={`${scopeLabel} 추가 번역어`}
            onInput={(event) =>
              setDraft((prev) => ({
                ...prev,
                target: (event.currentTarget as HTMLInputElement).value,
              }))
            }
          />
        </div>
        <div>
          <span
            class="glossary-editor__visually-hidden"
            id={`${idPrefix}-add-case-label`}
          >
            대소문자 구분
          </span>
          <label class="glossary-editor__checkbox-label" for={caseId}>
            <input
              id={caseId}
              type="checkbox"
              checked={draft.caseSensitive}
              disabled={disabled}
              aria-labelledby={`${idPrefix}-add-case-label`}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  caseSensitive: (event.currentTarget as HTMLInputElement)
                    .checked,
                }))
              }
            />
            대소문자 구분
          </label>
        </div>
      </div>
      <div class="glossary-editor__add-actions">
        <button
          type="button"
          class="glossary-editor__btn"
          disabled={disabled || !draft.term.trim()}
          onClick={submit}
        >
          항목 추가
        </button>
      </div>
    </div>
  );
}

export function GlossaryEditor(props: {
  value: GlossaryEditorValue;
  onChange: (value: GlossaryEditorValue) => void;
}) {
  const { value, onChange } = props;
  const baseId = useId();
  const siteKeys = useMemo(
    () => Object.keys(value.sites).sort((a, b) => a.localeCompare(b)),
    [value.sites],
  );

  const [selectedSite, setSelectedSite] = useState<string>(
    () => siteKeys[0] ?? '',
  );
  const [siteDraft, setSiteDraft] = useState('');

  useEffect(() => {
    if (selectedSite && value.sites[selectedSite] !== undefined) return;
    setSelectedSite(siteKeys[0] ?? '');
  }, [siteKeys, selectedSite, value.sites]);

  const activeSite =
    selectedSite && value.sites[selectedSite] !== undefined ? selectedSite : '';

  const patchGlobal = (index: number, patch: Partial<GlossaryEntry>) => {
    const next = value.global.map((entry, i) =>
      i === index ? { ...entry, ...patch } : entry,
    );
    onChange({ ...value, global: next });
  };

  const removeGlobal = (index: number) => {
    onChange({
      ...value,
      global: value.global.filter((_, i) => i !== index),
    });
  };

  const addGlobal = (entry: GlossaryEntry) => {
    onChange({ ...value, global: [...value.global, entry] });
  };

  const patchSite = (index: number, patch: Partial<GlossaryEntry>) => {
    if (!activeSite) return;
    const current = value.sites[activeSite] ?? [];
    const next = current.map((entry, i) =>
      i === index ? { ...entry, ...patch } : entry,
    );
    onChange(setEntriesForScope(value, 'site', activeSite, next));
  };

  const removeSiteEntry = (index: number) => {
    if (!activeSite) return;
    const current = value.sites[activeSite] ?? [];
    const next = current.filter((_, i) => i !== index);
    onChange(setEntriesForScope(value, 'site', activeSite, next));
  };

  const addSiteEntry = (entry: GlossaryEntry) => {
    if (!activeSite) return;
    const current = value.sites[activeSite] ?? [];
    onChange(
      setEntriesForScope(value, 'site', activeSite, [...current, entry]),
    );
  };

  const ensureSite = () => {
    const host = normalizeHostname(siteDraft);
    if (!host) return false;
    if (!value.sites[host]) {
      onChange({
        ...value,
        sites: { ...value.sites, [host]: [] },
      });
    }
    setSelectedSite(host);
    setSiteDraft('');
    return true;
  };

  const removeSiteBucket = () => {
    if (!activeSite) return;
    const rest = { ...value.sites };
    delete rest[activeSite];
    onChange({ ...value, sites: rest });
    const remaining = Object.keys(rest).sort((a, b) => a.localeCompare(b));
    setSelectedSite(remaining[0] ?? '');
  };

  const defaultsId = `${baseId}-use-defaults`;
  const siteSelectId = `${baseId}-site-select`;
  const siteInputId = `${baseId}-site-input`;

  const siteEntries = entriesForScope(value, 'site', activeSite);

  return (
    <div class="glossary-editor">
      <section aria-label="기본 용어집">
        <label class="glossary-editor__toggle" for={defaultsId}>
          <input
            id={defaultsId}
            type="checkbox"
            checked={value.useDefaults}
            onChange={(event) =>
              onChange({
                ...value,
                useDefaults: (event.currentTarget as HTMLInputElement).checked,
              })
            }
          />
          <span>
            기본 용어집 사용
            <span class="glossary-editor__hint">
              개발 문서에 흔한 영어 용어(props, state, hook 등)를 자동으로 keep
              처리합니다.
            </span>
          </span>
        </label>
      </section>

      <section aria-label="전역 용어집">
        <h2>전역 용어집</h2>
        <p class="glossary-editor__hint">
          모든 사이트에 공통 적용됩니다. 같은 용어는 사이트별 설정이 우선합니다.
        </p>
        <EntryTable
          scopeLabel="전역 용어집"
          entries={value.global}
          idPrefix={`${baseId}-global`}
          onUpdate={patchGlobal}
          onRemove={removeGlobal}
        />
        <AddEntryForm
          scopeLabel="전역 용어집"
          idPrefix={`${baseId}-global-add`}
          onAdd={addGlobal}
        />
      </section>

      <section aria-label="사이트별 용어집">
        <h2>사이트별 용어집</h2>
        <p class="glossary-editor__hint">
          hostname(예: docs.example.com)별로 전역을 덮어쓰는 항목을 둡니다.
        </p>

        <div class="glossary-editor__site-toolbar">
          {siteKeys.length > 0 ? (
            <>
              <label for={siteSelectId}>사이트 선택</label>
              <select
                id={siteSelectId}
                value={activeSite}
                aria-label="사이트별 용어집 hostname 선택"
                onChange={(event) =>
                  setSelectedSite(
                    (event.currentTarget as HTMLSelectElement).value,
                  )
                }
              >
                {siteKeys.map((host) => (
                  <option key={host} value={host}>
                    {host}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p class="glossary-editor__empty">등록된 사이트가 없습니다.</p>
          )}

          <label for={siteInputId}>hostname 추가 또는 입력</label>
          <div class="glossary-editor__row">
            <input
              id={siteInputId}
              type="text"
              value={siteDraft}
              placeholder="example.com"
              autocomplete="off"
              aria-label="사이트별 용어집 hostname 입력"
              onInput={(event) =>
                setSiteDraft((event.currentTarget as HTMLInputElement).value)
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  ensureSite();
                }
              }}
            />
            <button
              type="button"
              class="glossary-editor__btn"
              disabled={!siteDraft.trim()}
              aria-label="사이트 hostname 추가"
              onClick={() => {
                ensureSite();
              }}
            >
              사이트 추가
            </button>
            {activeSite ? (
              <button
                type="button"
                class="glossary-editor__btn glossary-editor__btn--danger"
                aria-label={`${activeSite} 사이트 용어집 제거`}
                onClick={removeSiteBucket}
              >
                사이트 제거
              </button>
            ) : null}
          </div>
        </div>

        {activeSite ? (
          <>
            <EntryTable
              scopeLabel={`${activeSite} 사이트 용어집`}
              entries={siteEntries}
              idPrefix={`${baseId}-site-${activeSite}`}
              onUpdate={patchSite}
              onRemove={removeSiteEntry}
            />
            <AddEntryForm
              scopeLabel={`${activeSite} 사이트`}
              idPrefix={`${baseId}-site-add-${activeSite}`}
              onAdd={addSiteEntry}
            />
          </>
        ) : null}
      </section>
    </div>
  );
}
