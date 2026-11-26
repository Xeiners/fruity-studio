/**
 * Generations de personnages en cours. Hors des composants : l'utilisateur peut
 * quitter la fiche pendant que Gemini travaille, le resultat est tout de meme enregistre.
 */
import { useSyncExternalStore } from "react";
import { invalidate, qk } from "@/hooks/queries";
import { queryClient } from "@/hooks/queryClient";
import { GeminiError, toGeminiError } from "@/services/gemini/errors";
import { generateCharacter, type GenerationPhase } from "@/services/gemini/generator";
import type { CharacterIdentity } from "@/services/gemini/schemas";
import { charactersApi } from "@/services/storage/characters";
import { settingsApi } from "@/services/storage/system";
import type { Character, CharacterEssentials } from "@/types";
import { notifySuccess } from "@/utils/notify";

export interface CharacterGenerationState {
  running: boolean;
  phase: GenerationPhase | null;
  startedAt: number;
  error: GeminiError | null;
}

export const CHARACTER_PHASE_LABEL: Record<GenerationPhase, string> = {
  writing: "Gemini prépare le personnage…",
  repairing: "Correction automatique de la réponse…",
  finalizing: "Préparation du prompt…",
};

const IDLE: CharacterGenerationState = { running: false, phase: null, startedAt: 0, error: null };

const states = new Map<string, CharacterGenerationState>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function publish(id: string, state: CharacterGenerationState) {
  if (state === IDLE) states.delete(id);
  else states.set(id, state);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCharacterGeneration(id: string): CharacterGenerationState {
  return useSyncExternalStore(subscribe, () => states.get(id) ?? IDLE);
}

export interface StartCharacterGeneration {
  character: Character;
  brief: CharacterEssentials;
  instruction: string;
  /** Version a faire evoluer (avec une instruction) ; null pour une nouvelle interpretation. */
  previous: CharacterIdentity | null;
}

export async function startCharacterGeneration({ character, brief, instruction, previous }: StartCharacterGeneration): Promise<void> {
  const id = character.id;
  if (states.get(id)?.running) return;
  const controller = new AbortController();
  controllers.set(id, controller);
  const startedAt = Date.now();
  publish(id, { running: true, phase: "writing", startedAt, error: null });

  try {
    const settings = await queryClient.fetchQuery({ queryKey: qk.settings, queryFn: settingsApi.get, staleTime: Infinity });
    const generated = await generateCharacter(
      {
        brief,
        olderNotes: character,
        instruction,
        previous,
        language: settings.defaultLanguage,
        promptLanguage: settings.promptLanguage,
        model: settings.geminiModel,
      },
      {
        signal: controller.signal,
        onPhase: (phase) => {
          if (!controller.signal.aborted) publish(id, { running: true, phase, startedAt, error: null });
        },
      },
    );
    if (controller.signal.aborted) return;
    const saved = await charactersApi.saveGeneration(id, generated);
    invalidate(queryClient, "character", "characters");
    publish(id, IDLE);
    notifySuccess(`Prompt de ${brief.name} prêt`, `Version ${saved.version} · ${saved.model}`);
  } catch (error) {
    if (controller.signal.aborted) return;
    const e = toGeminiError(error);
    publish(id, e.code === "cancelled" ? IDLE : { running: false, phase: null, startedAt: 0, error: e });
  } finally {
    if (controllers.get(id) === controller) controllers.delete(id);
  }
}

export function cancelCharacterGeneration(id: string) {
  controllers.get(id)?.abort();
  publish(id, IDLE);
}

export function clearCharacterGenerationError(id: string) {
  if (states.get(id)?.error) publish(id, IDLE);
}
