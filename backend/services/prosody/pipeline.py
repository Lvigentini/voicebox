"""The one entry point that joins the transformer to generation.

Both generation paths -- the persisted one and the streaming one -- need the
same thing: resolve the dictionary, compile a plan, and either render it or
step aside. Doing that in one place is what keeps the two paths from drifting,
and what makes "unmarked text behaves exactly as before" a property of a single
function rather than a claim repeated twice.

The step-aside matters. The overwhelmingly common script has no markup and no
dictionary hits, compiles to one plain run, and must take the existing
single-shot path untouched -- same call, same arguments, same audio. The
transformer is only allowed to cost something when it is actually doing
something.
"""

from __future__ import annotations

import logging

import numpy as np

from .annotate import annotate, rules_from_entries
from .compiler import compile_plan
from .ir import RenderPlan, Speech
from .parser import ProsodyParseError
from .renderer import render

logger = logging.getLogger(__name__)


def engine_capabilities(
    engine: str, model_size: str | None = None
) -> tuple[bool, list[str] | None]:
    """What *engine* can honour, read from the model registry.

    Derived here rather than assumed, so a plan's warnings describe the engine
    that will actually run. Computed from the configs directly because the
    `engine_supports_instruct`/`engine_languages` helpers live on another
    branch (#1023); once that lands this should call them instead of
    re-deriving the same answer.

    Capabilities differ *within* an engine -- Qwen CustomVoice honours instruct
    at 1.7B and discards it at 0.6B -- so a lookup keyed on the engine alone
    cannot answer correctly. Narrow to the variant that will actually run
    whenever the caller knows it.

    Without a *model_size* the answer stays conservative: a request that has
    not pinned a size can land on any variant, and claiming a capability the
    chosen one lacks is the failure this function exists to prevent. Erring the
    other way only costs a warning that was not strictly necessary.

    Narrowing by size was @hakimio's observation on #1036.
    """
    try:
        from ...backends import get_tts_model_configs

        configs = [c for c in get_tts_model_configs() if c.engine == engine]
        if not configs:
            return False, None

        if model_size is not None:
            configs = [c for c in configs if c.model_size == model_size] or configs
            supports_instruct = configs[0].supports_instruct
        else:
            supports_instruct = all(c.supports_instruct for c in configs)

        languages: list[str] = []
        for cfg in configs:
            languages.extend(lang for lang in cfg.languages if lang not in languages)
        return supports_instruct, languages or None
    except Exception:
        logger.debug("Engine capability lookup failed for %r", engine, exc_info=True)
        return False, None


def build_plan(
    text: str,
    *,
    engine: str,
    language: str,
    db=None,
    profile_id: str | None = None,
    supports_instruct: bool = False,
    engine_languages: list[str] | None = None,
    instruct: str | None = None,
) -> tuple[RenderPlan, str]:
    """Resolve dictionary entries and compile *text* into a plan.

    Returns the plan and the markup it came from, so a caller can log or show
    what the dictionary contributed.

    A malformed *hand-written* tag is an error the caller should surface, but
    it must not be able to take down a generation for someone who never used
    the feature -- so a parse failure falls back to treating the text as
    literal, which is what it would have been before any of this existed.
    """
    markup = text
    if db is not None:
        from ..pronunciation import get_entries

        entries = get_entries(db, language=language, profile_id=profile_id)
        if entries:
            markup, applied = annotate(text, rules_from_entries(entries))
            if applied:
                logger.info("Dictionary annotated %d term(s)", len(applied))

    try:
        plan = compile_plan(
            markup,
            engine=engine,
            default_language=language,
            supports_instruct=supports_instruct,
            engine_languages=engine_languages,
            base_instruct=instruct,
        )
    except ProsodyParseError as exc:
        logger.warning("Prosody markup did not parse (%s); treating it as plain text", exc)
        return (
            RenderPlan(nodes=[Speech(text=text, language=language, instruct=instruct)],
                       engine=engine),
            text,
        )

    for warning in plan.warnings:
        logger.info("Prosody: %s", warning.detail)

    return plan, markup


async def generate_with_prosody(
    text: str,
    *,
    engine: str,
    language: str,
    generate_chunked_fn,
    tts_model,
    voice_prompt,
    gen_kwargs: dict,
    db=None,
    profile_id: str | None = None,
    supports_instruct: bool = False,
    engine_languages: list[str] | None = None,
    seed: int | None = None,
    enabled: bool = True,
    on_plan=None,
) -> tuple[np.ndarray, int]:
    """Generate *text*, taking the transformer only when it has work to do.

    ``generate_chunked_fn`` is passed in rather than imported so this composes
    with the existing chunking rather than competing with it: prosody splits by
    directive, chunking splits by length, and a single directive run that is
    still too long goes through both.

    Args:
        gen_kwargs: The arguments the caller would have used for a plain
            generation. Per-run values override language, seed and instruct;
            everything else -- trim, runaway detection, chunk size -- carries
            through unchanged.
        enabled: False renders the text literally, for a script that genuinely
            contains something shaped like a tag.
        on_plan: Called with the compiled plan before anything is rendered,
            including when the plan turns out trivial. A caller with somewhere
            to put them -- a `generations` row, a status stream -- uses this to
            surface warnings; one without it passes nothing and they stay in
            the log. A warning is worth reporting whether or not the plan
            ended up being segmented.
    """
    if not enabled:
        return await generate_chunked_fn(tts_model, text, voice_prompt, **gen_kwargs)

    plan, _markup = build_plan(
        text,
        engine=engine,
        language=language,
        db=db,
        profile_id=profile_id,
        supports_instruct=supports_instruct,
        engine_languages=engine_languages,
        instruct=gen_kwargs.get("instruct"),
    )

    if on_plan is not None:
        await on_plan(plan)

    if plan.is_trivial:
        # Nothing to do. Same call the caller would have made, with the one
        # difference that a dictionary respelling may have changed the text.
        single = plan.nodes[0]
        return await generate_chunked_fn(tts_model, single.text, voice_prompt, **gen_kwargs)

    plan = plan.with_seeds(seed)

    async def generate_run(node: Speech):
        run_kwargs = dict(gen_kwargs)
        run_kwargs["language"] = node.language
        run_kwargs["seed"] = node.seed
        run_kwargs["instruct"] = node.instruct
        return await generate_chunked_fn(tts_model, node.text, voice_prompt, **run_kwargs)

    logger.info(
        "Prosody: rendering %d run(s) across %d node(s)",
        sum(1 for n in plan.nodes if isinstance(n, Speech)),
        len(plan.nodes),
    )
    return await render(
        plan,
        generate_run,
        crossfade_ms=gen_kwargs.get("crossfade_ms", 50),
    )
