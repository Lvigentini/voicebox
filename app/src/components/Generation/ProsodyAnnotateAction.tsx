/**
 * Hands the script to the local LLM and asks it to draft prosody markup.
 *
 * This is the half of the feature a snippet list cannot reach. Inserting
 * `<break time="700ms"/>` at the caret helps someone who already knows they
 * want a pause there; it does nothing for someone looking at four paragraphs
 * of narration wondering where the pauses go. The annotator answers that
 * question, and its output is ordinary markup that goes through exactly the
 * same pipeline as markup typed by hand.
 *
 * The suggestion is always shown before it is applied. The backend already
 * refuses a suggestion whose words differ from the input — the model may fail
 * to help, but it may not rewrite the script — and this adds the second half
 * of that contract: the author sees the markup and chooses.
 *
 * Availability is asked for rather than assumed, so an install without the
 * model gets a disabled control with a reason instead of a 409 on click.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Loader2, WandSparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api/client';
import type { ProsodyAnnotateResponse } from '@/lib/api/types';

/** The backend caps annotation input well below the generate box's own limit. */
const MAX_ANNOTATE_CHARS = 10000;

interface ProsodyAnnotateActionProps {
  text: string;
  language: string;
  onAccept: (markup: string) => void;
}

export function ProsodyAnnotateAction({
  text,
  language,
  onAccept,
}: ProsodyAnnotateActionProps) {
  const { t } = useTranslation();
  const [suggestion, setSuggestion] = useState<ProsodyAnnotateResponse | null>(null);

  const { data: availability } = useQuery({
    queryKey: ['prosodyAnnotateAvailability'],
    queryFn: () => apiClient.getProsodyAnnotationAvailability(),
    // Loading a model is a manual act, so this changes rarely — but not never,
    // and a stale "unavailable" would hide the feature for the whole session.
    staleTime: 60_000,
    retry: false,
  });

  const annotate = useMutation({
    mutationFn: () => apiClient.annotateProsody({ text, language }),
    onSuccess: setSuggestion,
  });

  const trimmed = text.trim();
  const tooLong = trimmed.length > MAX_ANNOTATE_CHARS;
  const disabled =
    !trimmed || tooLong || annotate.isPending || availability?.available === false;

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium">{t('generation.prosody.annotateTitle')}</span>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">
            {availability?.available === false
              ? t('generation.prosody.annotateUnavailable')
              : tooLong
                ? t('generation.prosody.annotateTooLong', { max: MAX_ANNOTATE_CHARS })
                : t('generation.prosody.annotateHint')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
          disabled={disabled}
          onClick={() => annotate.mutate()}
        >
          {annotate.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <WandSparkles className="h-3 w-3" />
          )}
          {t('generation.prosody.annotateAction')}
        </Button>
      </div>

      {annotate.isError && (
        <p className="mt-2 text-[11px] leading-snug text-destructive">
          {annotate.error instanceof Error
            ? annotate.error.message
            : t('generation.prosody.annotateFailed')}
        </p>
      )}

      {suggestion && (
        <div className="mt-2.5">
          {/* Three outcomes worth telling apart: the model declined to change
              anything, the guard rejected what it produced, or there is a
              suggestion to look at. Collapsing them into one message would
              leave the author unable to tell "no pauses needed" from "the
              model tried to rewrite your script". */}
          {!suggestion.accepted ? (
            <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-500">
              {t('generation.prosody.annotateRejected')}
              {suggestion.rejected_reason ? ` ${suggestion.rejected_reason}` : ''}
            </p>
          ) : !suggestion.changed ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t('generation.prosody.annotateNoChange')}
            </p>
          ) : (
            <>
              <pre className="max-h-[140px] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-snug">
                {suggestion.markup}
              </pre>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() => {
                    onAccept(suggestion.markup);
                    setSuggestion(null);
                  }}
                >
                  <Check className="h-3 w-3" />
                  {t('generation.prosody.annotateAccept')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() => setSuggestion(null)}
                >
                  <X className="h-3 w-3" />
                  {t('generation.prosody.annotateDiscard')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
