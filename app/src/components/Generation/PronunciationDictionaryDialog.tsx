/**
 * The pronunciation dictionary, opened from the generate box.
 *
 * Until now the dictionary had five endpoints, three strategies and no way to
 * reach any of them from the app, which made it a feature that existed only in
 * the API. Worse, it is invisible by construction: entries are applied during
 * generation and the rewritten text is never stored, so an author who has one
 * cannot tell it apart from the model simply saying the word that way.
 *
 * This is deliberately not a settings screen. It opens where the mispronounced
 * word is — with the term pre-filled from whatever was selected in the script —
 * because the moment someone wants a dictionary entry is the moment they have
 * just heard one go wrong, and a rule written then is written with the evidence
 * in front of them.
 *
 * The list shows what applies to the current voice and language rather than
 * everything, since those are the entries that can explain what the author is
 * hearing. `include_disabled` stays on: an entry switched off is exactly what
 * someone hunting a missing substitution needs to see.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiClient } from '@/lib/api/client';
import type { PronunciationEntry } from '@/lib/api/types';
import { ALL_LANGUAGES, type LanguageCode } from '@/lib/constants/languages';
import { cn } from '@/lib/utils/cn';
import { PronunciationEntryForm } from './PronunciationEntryForm';

interface PronunciationDictionaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: string;
  profileId?: string | null;
  profileName?: string;
  /** The word selected in the script when this was opened, if any. Pre-fills a
   * new entry so the common case is two clicks and a respelling. */
  initialTerm?: string;
}

export function PronunciationDictionaryDialog({
  open,
  onOpenChange,
  language,
  profileId,
  profileName,
  initialTerm,
}: PronunciationDictionaryDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // `null` closes the form; `'new'` opens it empty; an entry opens it loaded.
  const [editing, setEditing] = useState<PronunciationEntry | 'new' | null>(
    initialTerm ? 'new' : null,
  );
  // Deleting takes two clicks rather than a nested confirm dialog. An
  // AlertDialog inside a Dialog fights over the focus trap, and the entry is
  // small enough that arming the button is proportionate to the loss.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  // This component stays mounted across opens, so both of those have to be
  // re-seeded each time — otherwise the second open shows the form left over
  // from the first, filled with the previous selection.
  useEffect(() => {
    if (!open) return;
    setEditing(initialTerm ? 'new' : null);
    setConfirmingDelete(null);
  }, [open, initialTerm]);

  const { data: entries, isLoading } = useQuery({
    queryKey: ['pronunciations', language, profileId ?? null],
    queryFn: () =>
      apiClient.listPronunciations({
        language,
        profile_id: profileId ?? undefined,
        include_disabled: true,
      }),
    enabled: open,
  });

  const toggle = useMutation({
    mutationFn: (entry: PronunciationEntry) =>
      apiClient.updatePronunciation(entry.id, { enabled: !entry.enabled }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (entryId: string) => apiClient.deletePronunciation(entryId),
    onSuccess: invalidate,
  });

  const failure = toggle.error ?? remove.error;
  const mutationError = failure
    ? failure instanceof Error
      ? failure.message
      : t('generation.pronunciation.saveFailed')
    : null;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['pronunciations'] });
    // Same reason as in the form: the plan preview's key does not include the
    // dictionary, so disabling or deleting an entry silently invalidates a
    // cached plan that nothing else will refetch.
    queryClient.invalidateQueries({ queryKey: ['prosodyPreview'] });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookMarked className="h-4 w-4" />
            {t('generation.pronunciation.title')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('generation.pronunciation.scopeNote', {
              language: ALL_LANGUAGES[language as LanguageCode] ?? language,
              voice: profileName ?? t('generation.pronunciation.anyVoice'),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('generation.pronunciation.loading')}
            </div>
          ) : entries && entries.length > 0 ? (
            <ul className="space-y-1.5">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className={cn(
                    'flex items-start gap-2 rounded-xl border border-border/60 px-2.5 py-2',
                    // A disabled entry stays legible but is clearly not in
                    // play — it is listed to explain an absence, not as a rule.
                    !entry.enabled && 'opacity-55',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="break-words text-xs font-medium">{entry.term}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {describeRealisation(entry, t)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className="text-[10px]">
                        {t(`generation.pronunciation.strategy.${entry.strategy}.label`)}
                      </Badge>
                      {/* Scope is the field most likely to explain why a rule
                          did not fire, so it is on the row rather than behind
                          an edit click. */}
                      <Badge variant="secondary" className="text-[10px]">
                        {entry.profile_id
                          ? t('generation.pronunciation.badgeThisVoice')
                          : t('generation.pronunciation.badgeAllVoices')}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {entry.language
                          ? (ALL_LANGUAGES[entry.language as LanguageCode] ?? entry.language)
                          : t('generation.pronunciation.badgeAllLanguages')}
                      </Badge>
                      {!entry.enabled && (
                        <Badge variant="outline" className="text-[10px]">
                          {t('generation.pronunciation.badgeDisabled')}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => toggle.mutate(entry)}
                      disabled={toggle.isPending}
                    >
                      {entry.enabled
                        ? t('generation.pronunciation.disable')
                        : t('generation.pronunciation.enable')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={t('common.edit')}
                      onClick={() => setEditing(entry)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    {confirmingDelete === entry.id ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => {
                          remove.mutate(entry.id);
                          setConfirmingDelete(null);
                        }}
                        disabled={remove.isPending}
                      >
                        {t('generation.pronunciation.confirmDelete')}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        aria-label={t('common.delete')}
                        onClick={() => setConfirmingDelete(entry.id)}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-border/60 px-3 py-4 text-[11px] leading-snug text-muted-foreground">
              {t('generation.pronunciation.empty')}
            </p>
          )}

          {editing ? (
            <PronunciationEntryForm
              entry={editing === 'new' ? null : editing}
              initialTerm={editing === 'new' ? initialTerm : undefined}
              language={language}
              profileId={profileId}
              profileName={profileName}
              onDone={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full gap-1.5 text-[11px]"
              onClick={() => setEditing('new')}
            >
              <Plus className="h-3 w-3" />
              {t('generation.pronunciation.addAction')}
            </Button>
          )}
        </div>

        {mutationError && (
          <p className="text-[11px] leading-snug text-destructive">{mutationError}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One line saying what the entry actually does, in the strategy's own terms.
 * Showing `replacement` for a `language` entry would read as a no-op, because
 * for that strategy it is deliberately the term itself. */
function describeRealisation(
  entry: PronunciationEntry,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (entry.strategy === 'language' && entry.spoken_language) {
    return t('generation.pronunciation.realisedAsLanguage', {
      language: ALL_LANGUAGES[entry.spoken_language as LanguageCode] ?? entry.spoken_language,
    });
  }
  if (entry.strategy === 'phoneme' && entry.phonemes) {
    return `→ ${entry.phonemes}`;
  }
  return `→ ${entry.replacement}`;
}
