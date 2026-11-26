import { composeFlowPrompt } from "@/services/gemini/flowPrompt";
import { resolvePromptLanguage } from "@/services/gemini/prompts";
import type { ClipContent } from "@/services/gemini/schemas";
import type { CharacterSummary, ProductionDetail } from "@/types";

/** Recompose le prompt final d'un clip a partir de son contenu et de la production. */
export function recomposePrompt(production: ProductionDetail, content: ClipContent, library: CharacterSummary[]): string {
  const story = production.story;
  const lang = production.params.language ?? story.language ?? "fr";
  const withRefs = production.characters
    .filter((c) => (library.find((l) => l.id === c.id)?.imageCount ?? 0) > 0)
    .map((c) => c.name);
  return composeFlowPrompt({
    clip: content,
    clipCount: production.clips.length,
    clipDuration: production.clipDuration,
    visualStyle: story.visualStyle ?? "",
    descriptors: story.characterDescriptors ?? [],
    promptLanguage: resolvePromptLanguage(production.params.promptLanguage ?? "en", lang),
    storyLanguage: lang,
    charactersWithReferences: withRefs,
  });
}
