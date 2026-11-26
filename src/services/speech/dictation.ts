/**
 * Dictee en direct avec Vosk (WebAssembly) : tout se passe dans l'application,
 * sans compte ni quota, et le texte arrive pendant que l'utilisateur parle.
 */
import { createModel, type Model } from "vosk-browser";

const MODEL_URL = "/models/vosk-fr.tar.gz";
const MODEL_LOAD_LIMIT_MS = 60_000;
const SILENCE_LIMIT_MS = 20_000;
const FINAL_RESULT_WAIT_MS = 1_500;

let modelLoading: Promise<Model> | null = null;

function loadModel(): Promise<Model> {
  // Sans limite, un moteur qui ne demarre pas laisserait le bouton bloque indefiniment.
  const tooLong = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Modele vocal trop long a charger.")), MODEL_LOAD_LIMIT_MS));
  modelLoading ??= Promise.race([createModel(new URL(MODEL_URL, window.location.href).href), tooLong]).catch((error) => {
    modelLoading = null;
    throw error;
  });
  return modelLoading;
}

/** Vosk rend du texte brut : chaque phrase terminee recoit sa majuscule et son point. */
export function formatSentence(text: string): string {
  const clean = text.trim();
  return clean ? `${clean.charAt(0).toLocaleUpperCase("fr")}${clean.slice(1)}.` : "";
}

export interface DictationCallbacks {
  /** Phrases terminees, et phrase en cours qui peut encore changer. */
  onUpdate: (committed: string, partial: string) => void;
  /** Personne n'a parle depuis un moment. */
  onSilence: () => void;
}

export interface DictationSession {
  stop: () => Promise<void>;
}

export async function startDictation({ onUpdate, onSilence }: DictationCallbacks): Promise<DictationSession> {
  const model = await loadModel();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const context = new AudioContext();
  const recognizer = new model.KaldiRecognizer(context.sampleRate);

  let committed = "";
  let lastSpeech = Date.now();
  let finalResult: (() => void) | null = null;

  recognizer.on("partialresult", (message) => {
    if (message.event !== "partialresult") return;
    if (message.result.partial) lastSpeech = Date.now();
    onUpdate(committed, message.result.partial);
  });
  recognizer.on("result", (message) => {
    if (message.event !== "result") return;
    const sentence = formatSentence(message.result.text);
    if (sentence) {
      committed = committed ? `${committed} ${sentence}` : sentence;
      lastSpeech = Date.now();
    }
    onUpdate(committed, "");
    finalResult?.();
  });

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => recognizer.acceptWaveform(event.inputBuffer);
  source.connect(processor);
  processor.connect(context.destination);

  const silenceTimer = setInterval(() => {
    if (Date.now() - lastSpeech > SILENCE_LIMIT_MS) onSilence();
  }, 1_000);

  let stopping: Promise<void> | null = null;
  const stop = () => {
    stopping ??= (async () => {
      clearInterval(silenceTimer);
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      // La derniere phrase arrive apres l'arret du micro.
      const received = new Promise<void>((resolve) => {
        finalResult = resolve;
        setTimeout(resolve, FINAL_RESULT_WAIT_MS);
      });
      recognizer.retrieveFinalResult();
      await received;
      recognizer.remove();
      await context.close();
    })();
    return stopping;
  };

  return { stop };
}
