/**
 * Shows what the current script will actually be turned into, before anything
 * is generated.
 *
 * The plan is compiled server-side with no model behind it, so this costs a
 * cheap round trip rather than a generation. That is the point: a directive the
 * chosen engine will ignore, or a rate that covers more words than intended, is
 * visible here instead of being discovered after a thirty-second wait.
 *
 * Adapted from @hakimio's proposal on #1036 —
 *   https://github.com/hakimio/voicebox/tree/feat/prosody-user-facing
 * — and extended to the dictionary. Their preview compiles markup alone, which
 * is the whole story on their branch; here the pronunciation dictionary can
 * inject directives into a script that contains none, so a preview that only
 * showed hand-written markup would show nothing at all for the case where the
 * author most needs to know what changed. `dictionary_terms` and the
 * substitution arrows below are that difference.
 */

import { AlertTriangle, ArrowRight, BookMarked, Pause } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type { ProsodyPlanNode } from '@/lib/api/types';
import { Badge } from '@/components/ui/badge';

/** Debounce so a plan is not compiled on every keystroke. */
const DEBOUNCE_MS = 400;

interface ProsodyPlanPreviewProps {
  text: string;
  engine: string;
  language: string;
  modelSize?: string;
  instruct?: string;
  /** Scopes the dictionary. Entries can be global or attached to one voice, so
   * a preview without this shows the wrong set for a profile-scoped term. */
  profileId?: string | null;
  /** Raised when compilation fails, so the caller can surface the parser's
   * message the same way it surfaces a failed generation. */
  onParseError?: (message: string | null) => void;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function ProsodyPlanPreview({
  text,
  engine,
  language,
  modelSize,
  instruct,
  profileId,
  onParseError,
}: ProsodyPlanPreviewProps) {
  const { t } = useTranslation();
  const debouncedText = useDebounced(text, DEBOUNCE_MS);

  const { data, isFetching, error } = useQuery({
    queryKey: [
      'prosodyPreview',
      debouncedText,
      engine,
      language,
      modelSize,
      instruct,
      profileId,
    ],
    queryFn: () =>
      apiClient.previewProsody({
        text: debouncedText,
        engine,
        language,
        model_size: modelSize,
        instruct: instruct || null,
        profile_id: profileId || null,
      }),
    enabled: debouncedText.trim().length > 0,
    // A plan is a pure function of its inputs, so a cached one never goes
    // stale — except through the dictionary, which the caller invalidates by
    // key when an entry changes.
    staleTime: Infinity,
    retry: false,
  });

  const parseError = error instanceof Error ? error.message : null;

  useEffect(() => {
    onParseError?.(parseError);
  }, [parseError, onParseError]);

  if (parseError) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs font-medium text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t('generation.prosody.previewError')}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-destructive/90">{parseError}</p>
      </div>
    );
  }

  if (isFetching && !data) {
    return (
      <div className="rounded-2xl border border-border/60 px-3 py-2.5 text-[11px] text-muted-foreground">
        {t('generation.prosody.previewLoading')}
      </div>
    );
  }

  if (!data) return null;

  const silenceMs = data.nodes.reduce((total, node) => total + (node.ms ?? 0), 0);
  // Nothing was directed and nothing was substituted: this script takes the
  // ordinary single-shot path and there is no plan worth drawing.
  const nothingToShow = data.is_trivial && data.dictionary_terms.length === 0;

  if (nothingToShow) {
    return (
      <div className="rounded-2xl border border-border/60 px-3 py-2.5 text-[11px] text-muted-foreground">
        {t('generation.prosody.previewEmpty')}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{t('generation.prosody.previewTitle')}</span>
        <Badge variant="secondary" className="text-[10px]">
          {t('generation.prosody.previewRuns', { count: data.run_count })}
        </Badge>
        {silenceMs > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {t('generation.prosody.previewSilenceTotal', { ms: silenceMs })}
          </Badge>
        )}
      </div>

      {/* What the dictionary did. Called out separately from the plan rows
          because the author did not type it, and a substitution they did not
          expect is the one thing here they cannot deduce from their own
          script. */}
      {data.dictionary_terms.length > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-muted/50 px-2 py-1.5">
          <BookMarked className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="text-[11px] leading-snug text-foreground/90">
            {t('generation.prosody.previewDictionary', {
              count: data.dictionary_terms.length,
              terms: data.dictionary_terms.join(', '),
            })}
          </span>
        </div>
      )}

      {/* Warnings next: a directive that silently does nothing is the failure
          mode this panel exists to prevent. */}
      {data.warnings.length > 0 && (
        <ul className="mt-2 max-h-[96px] space-y-1.5 overflow-y-auto pr-1">
          {data.warnings.map((warning) => (
            <li
              key={warning.code + warning.detail}
              className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-2 py-1.5"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
              <span className="text-[11px] leading-snug text-foreground/90">
                {warning.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      {data.is_trivial ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {t('generation.prosody.previewTrivial')}
        </p>
      ) : (
        // A long script compiles to dozens of rows. Cap the list and scroll it
        // here rather than letting the panel grow the floating box past the
        // viewport, which pushes it over the window chrome.
        <ol className="mt-2 max-h-[240px] space-y-1 overflow-y-auto pr-1">
          {data.nodes.map((node, index) => (
            <PlanRow
              // Plan nodes have no id and identical runs are legitimate, so the
              // index is the only stable key here.
              key={`${node.kind}-${index}`}
              node={node}
              // Number the speech runs 1..N so the last one matches the run
              // count in the header. Numbering by node index skips every
              // silence and reads as though rows were missing.
              runNumber={runNumberAt(data.nodes, index)}
              defaultLanguage={language}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

/** How many speech runs there are up to and including `index` — the run's
 * 1-based ordinal, or 0 for a silence. */
function runNumberAt(nodes: ProsodyPlanNode[], index: number): number {
  if (nodes[index]?.kind !== 'speech') return 0;
  let count = 0;
  for (let i = 0; i <= index; i += 1) {
    if (nodes[i].kind === 'speech') count += 1;
  }
  return count;
}

function PlanRow({
  node,
  runNumber,
  defaultLanguage,
}: {
  node: ProsodyPlanNode;
  runNumber: number;
  defaultLanguage: string;
}) {
  const { t } = useTranslation();

  if (node.kind === 'silence') {
    return (
      // Indented to the run text so the column of numbers stays unbroken.
      <li className="flex items-center gap-2 pl-6 text-[11px] text-muted-foreground">
        <Pause className="h-3 w-3 shrink-0" />
        {t('generation.prosody.previewPause', { ms: node.ms ?? 0 })}
      </li>
    );
  }

  const showLanguage = !!node.language && node.language !== defaultLanguage;
  const showRate = typeof node.rate === 'number' && node.rate !== 1;

  return (
    <li className="flex items-start gap-2 text-[11px]">
      <span className="mt-0.5 w-4 shrink-0 text-right text-muted-foreground/60">
        {runNumber}
      </span>
      <span className="min-w-0 flex-1">
        {/* Show what the author wrote; the substitution is called out after it,
            so the row still reads as their own script. */}
        <span className="break-words text-foreground/90">
          {node.source_text ?? node.text}
        </span>
        {/* Only annotate what differs from the request's own settings —
            repeating "en, rate 1.0" on every run would bury the exceptions. */}
        {showLanguage && (
          <Badge variant="outline" className="ml-1.5 align-middle text-[10px]">
            {node.language}
          </Badge>
        )}
        {showRate && (
          <Badge variant="outline" className="ml-1.5 align-middle text-[10px]">
            {t('generation.prosody.previewRate', { rate: node.rate })}
          </Badge>
        )}
        {node.source_text && (
          <span className="ml-1.5 inline-flex items-center gap-1 align-middle text-[10px] text-muted-foreground">
            <ArrowRight className="h-2.5 w-2.5" />
            {t('generation.prosody.previewSpokenAs')} &ldquo;{node.text}&rdquo;
          </span>
        )}
      </span>
    </li>
  );
}
