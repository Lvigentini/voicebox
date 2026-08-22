/**
 * Add or edit one pronunciation dictionary entry.
 *
 * The dictionary is resolved into prosody markup at generation time — a
 * respelling becomes `<sub>`, a language becomes `<lang>`, a transcription
 * becomes `<phoneme>` — so this form is the no-markup way to reach the same
 * machinery as the directives in the help popover. Someone who never wants to
 * learn the tags can still fix a name the model keeps getting wrong, once,
 * permanently.
 *
 * `replacement` is required by the API whatever the strategy, because it is
 * the fallback when the chosen strategy cannot be realised on the target
 * engine. The form reflects that rather than hiding it: for `language` it is
 * the term itself (the words do not change, only who reads them), and for
 * `phoneme` it is an editable spelling used on engines that take no phonemes.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient } from '@/lib/api/client';
import type { PronunciationEntry, PronunciationStrategy } from '@/lib/api/types';
import { ALL_LANGUAGES, LANGUAGE_OPTIONS, type LanguageCode } from '@/lib/constants/languages';

const STRATEGIES: PronunciationStrategy[] = ['respell', 'language', 'phoneme'];

interface PronunciationEntryFormProps {
  /** The entry being edited, or null to create one. */
  entry: PronunciationEntry | null;
  /** Pre-fills the term on a new entry — normally the word the author had
   * selected in the script when they opened this. */
  initialTerm?: string;
  /** The generation's current settings. They seed the scope, since the entry
   * is almost always being written about the voice and language in front of
   * the author right now. */
  language: string;
  profileId?: string | null;
  profileName?: string;
  onDone: () => void;
  onCancel: () => void;
}

export function PronunciationEntryForm({
  entry,
  initialTerm,
  language,
  profileId,
  profileName,
  onDone,
  onCancel,
}: PronunciationEntryFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [term, setTerm] = useState(entry?.term ?? initialTerm ?? '');
  const [strategy, setStrategy] = useState<PronunciationStrategy>(
    entry?.strategy ?? 'respell',
  );
  const [replacement, setReplacement] = useState(entry?.replacement ?? '');
  const [spokenLanguage, setSpokenLanguage] = useState(
    entry?.spoken_language ?? (language === 'en' ? 'es' : 'en'),
  );
  const [phonemes, setPhonemes] = useState(entry?.phonemes ?? '');
  // A new entry defaults to the narrowest scope that matches what the author
  // is looking at. Widening it later is one click; discovering that a rule
  // written for one voice has been mangling every other one is not.
  const [scopeToVoice, setScopeToVoice] = useState(
    entry ? entry.profile_id != null : !!profileId,
  );
  const [scopeToLanguage, setScopeToLanguage] = useState(
    entry ? entry.language != null : true,
  );

  // Picking a different row while the form is open has to reload it: the
  // component stays mounted, so the state above would still describe the
  // entry that was being edited a moment ago.
  useEffect(() => {
    if (!entry) return;
    setTerm(entry.term);
    setStrategy(entry.strategy);
    setReplacement(entry.replacement);
    setSpokenLanguage(entry.spoken_language ?? 'en');
    setPhonemes(entry.phonemes ?? '');
    setScopeToVoice(entry.profile_id != null);
    setScopeToLanguage(entry.language != null);
  }, [entry]);

  const trimmedTerm = term.trim();
  // For `language` the spoken text is unchanged, so the term is its own
  // fallback and a second field would only be somewhere to make a mistake.
  const effectiveReplacement =
    strategy === 'language' ? trimmedTerm : replacement.trim() || trimmedTerm;

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        term: trimmedTerm,
        replacement: effectiveReplacement,
        strategy,
        spoken_language: strategy === 'language' ? spokenLanguage : null,
        phonemes: strategy === 'phoneme' ? phonemes.trim() : null,
        language: scopeToLanguage ? language : null,
        profile_id: scopeToVoice ? (profileId ?? null) : null,
      };
      return entry
        ? apiClient.updatePronunciation(entry.id, payload)
        : apiClient.createPronunciation(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pronunciations'] });
      // The plan preview caches with `staleTime: Infinity` and keys on the
      // script rather than the dictionary, so a new entry changes the answer
      // without changing the key. Nothing else would evict it.
      queryClient.invalidateQueries({ queryKey: ['prosodyPreview'] });
      onDone();
    },
  });

  const missingStrategyField =
    (strategy === 'respell' && !replacement.trim()) ||
    (strategy === 'language' && !spokenLanguage) ||
    (strategy === 'phoneme' && !phonemes.trim());
  const canSave = !!trimmedTerm && !missingStrategyField && !mutation.isPending;

  return (
    <form
      className="space-y-3 rounded-xl border border-border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) mutation.mutate();
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="pron-term" className="text-[11px] font-medium">
          {t('generation.pronunciation.fieldTerm')}
        </label>
        <Input
          id="pron-term"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t('generation.pronunciation.fieldTermPlaceholder')}
          className="h-8 text-xs"
          maxLength={200}
        />
      </div>

      <div className="space-y-1.5">
        <span className="text-[11px] font-medium">
          {t('generation.pronunciation.fieldStrategy')}
        </span>
        <div className="flex gap-1.5">
          {STRATEGIES.map((option) => (
            <Button
              key={option}
              type="button"
              variant={strategy === option ? 'default' : 'outline'}
              size="sm"
              className="h-7 flex-1 px-2 text-[11px]"
              onClick={() => setStrategy(option)}
            >
              {t(`generation.pronunciation.strategy.${option}.label`)}
            </Button>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground/80">
          {t(`generation.pronunciation.strategy.${strategy}.description`)}
        </p>
      </div>

      {strategy === 'respell' && (
        <div className="space-y-1.5">
          <label htmlFor="pron-replacement" className="text-[11px] font-medium">
            {t('generation.pronunciation.fieldReplacement')}
          </label>
          <Input
            id="pron-replacement"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            placeholder={t('generation.pronunciation.fieldReplacementPlaceholder')}
            className="h-8 text-xs"
            maxLength={200}
          />
        </div>
      )}

      {strategy === 'language' && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium">
            {t('generation.pronunciation.fieldSpokenLanguage')}
          </span>
          <Select value={spokenLanguage} onValueChange={setSpokenLanguage}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-xs">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {strategy === 'phoneme' && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="pron-phonemes" className="text-[11px] font-medium">
              {t('generation.pronunciation.fieldPhonemes')}
            </label>
            <Input
              id="pron-phonemes"
              value={phonemes}
              onChange={(event) => setPhonemes(event.target.value)}
              placeholder="banˈdexa"
              className="h-8 font-mono text-xs"
              maxLength={500}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pron-fallback" className="text-[11px] font-medium">
              {t('generation.pronunciation.fieldFallback')}
            </label>
            <Input
              id="pron-fallback"
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              placeholder={trimmedTerm || t('generation.pronunciation.fieldFallbackPlaceholder')}
              className="h-8 text-xs"
              maxLength={200}
            />
            <p className="text-[11px] leading-snug text-muted-foreground/80">
              {t('generation.pronunciation.fieldFallbackHint')}
            </p>
          </div>
        </>
      )}

      <div className="space-y-2 border-t border-border/60 pt-2.5">
        <span className="text-[11px] font-medium">
          {t('generation.pronunciation.fieldScope')}
        </span>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Checkbox
            checked={scopeToVoice}
            disabled={!profileId}
            onCheckedChange={setScopeToVoice}
          />
          {profileName
            ? t('generation.pronunciation.scopeVoiceNamed', { name: profileName })
            : t('generation.pronunciation.scopeVoice')}
        </label>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Checkbox checked={scopeToLanguage} onCheckedChange={setScopeToLanguage} />
          {t('generation.pronunciation.scopeLanguage', {
            language: ALL_LANGUAGES[language as LanguageCode] ?? language,
          })}
        </label>
      </div>

      {mutation.isError && (
        <p className="text-[11px] leading-snug text-destructive">
          {mutation.error instanceof Error
            ? mutation.error.message
            : t('generation.pronunciation.saveFailed')}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          className="h-7 gap-1.5 px-3 text-[11px]"
          disabled={!canSave}
        >
          {mutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {entry ? t('common.save') : t('generation.pronunciation.addAction')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-3 text-[11px]"
          onClick={onCancel}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
