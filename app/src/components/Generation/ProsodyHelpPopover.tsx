/**
 * Help for the prosody directives, with one-click insertion and an option to
 * have the local model draft them.
 *
 * The directives are plain text typed into the script, so discoverability is
 * the whole problem: nothing in the text box hints that `<break time="700ms"/>`
 * does anything at all. This lists the closed set the parser accepts, drops a
 * working snippet at the caret, and — for anyone who would rather not learn a
 * markup language to add a pause — hands the script to the annotator instead.
 *
 * Adapted from @hakimio's proposal on #1036, which is where the shape of this
 * (a popover of snippets rather than a toolbar or a rich editor) comes from:
 *   https://github.com/hakimio/voicebox/tree/feat/prosody-user-facing
 *
 * Deliberately not engine-gated. Pauses, language spans and rate are realised
 * by cutting and reassembling rather than by asking the engine, so they work
 * everywhere; only <emphasis> depends on a capability, and the plan preview
 * says so when it does not apply.
 */

// Braces, not SlidersHorizontal — that one is already the delivery-instruction
// toggle in the same button row.
import { Braces } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils/cn';
import { ProsodyAnnotateAction } from './ProsodyAnnotateAction';

/** The snippet inserted for each tag, and where the caret should land after.
 *
 * `caretOffset` counts back from the end of the snippet: for a span tag the
 * caret goes between the tags so the user can type the affected words, and for
 * the void <break/> it goes after, since there is nothing to wrap. */
const PROSODY_TAGS = [
  { key: 'break', snippet: '<break time="700ms"/>', caretOffset: 0 },
  { key: 'lang', snippet: '<lang xml:lang="es"></lang>', caretOffset: 7 },
  { key: 'prosody', snippet: '<prosody rate="0.9"></prosody>', caretOffset: 10 },
  { key: 'emphasis', snippet: '<emphasis level="strong"></emphasis>', caretOffset: 11 },
  { key: 'sub', snippet: '<sub alias="ban-DEH-ha"></sub>', caretOffset: 6 },
  { key: 'phoneme', snippet: '<phoneme alphabet="ipa" ph="ban&#712;dexa"></phoneme>', caretOffset: 10 },
] as const;

interface ProsodyHelpPopoverProps {
  /** Inserts `snippet` at the caret and leaves the caret `caretOffset` characters
   * from the snippet's end. */
  onInsert: (snippet: string, caretOffset: number) => void;
  /** Replaces the whole script with drafted markup, once the user accepts it. */
  onReplaceText: (markup: string) => void;
  /** The current script, for the annotator to work on. */
  text: string;
  language: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}

export function ProsodyHelpPopover({
  onInsert,
  onReplaceText,
  text,
  language,
  open,
  onOpenChange,
  disabled,
}: ProsodyHelpPopoverProps) {
  const { t } = useTranslation();

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className={cn(
            'h-10 w-10 rounded-full transition-all duration-200',
            open
              ? 'bg-accent text-accent-foreground border border-accent hover:bg-accent/90'
              : 'bg-card border border-border hover:bg-background/50',
          )}
          aria-label={open ? t('generation.prosody.hide') : t('generation.prosody.show')}
          aria-pressed={open}
        >
          <Braces className="h-4 w-4" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[400px] max-w-[92vw] p-0">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium">{t('generation.prosody.helpTitle')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('generation.prosody.helpIntro')}
          </p>
        </div>

        {/* The alternative to learning any of the below. Sits above the list
            because for most scripts it is the better first move. */}
        <ProsodyAnnotateAction
          text={text}
          language={language}
          onAccept={(markup) => {
            onReplaceText(markup);
            onOpenChange(false);
          }}
        />

        <ul className="max-h-[300px] overflow-y-auto py-1">
          {PROSODY_TAGS.map(({ key, snippet, caretOffset }) => (
            <li key={key} className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/50">
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium">
                  {t(`generation.prosody.tags.${key}.label`)}
                </span>
                {/* The snippet is the documentation — show it verbatim. */}
                <code className="mt-1 block break-all font-mono text-[11px] text-muted-foreground">
                  {snippet}
                </code>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground/80">
                  {t(`generation.prosody.tags.${key}.description`)}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-0.5 h-7 shrink-0 px-2 text-[11px]"
                onClick={() => onInsert(snippet, caretOffset)}
              >
                {t('generation.prosody.helpInsert')}
              </Button>
            </li>
          ))}
        </ul>

        <p className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          {t('generation.prosody.helpDocsHint')}
        </p>
      </PopoverContent>
    </Popover>
  );
}
