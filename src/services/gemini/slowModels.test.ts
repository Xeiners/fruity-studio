import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ calls: [] as string[], hanging: new Set<string>() }));

vi.mock("@google/genai", async (importActual) => {
  const actual = await importActual<typeof import("@google/genai")>();
  const output = {
    tiktokCaption: "Une légende de test assez longue.",
    tiktokHashtags: ["humour", "fruits", "animation", "cartoon"],
    youtubeTitle: "Un titre de test",
    youtubeDescription: "Une description de test.",
    youtubeHashtags: ["humour", "fruits", "animation"],
  };
  class GoogleGenAI {
    models = {
      list: async () =>
        (async function* () {
          for (const id of ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash-lite"]) {
            yield { name: `models/${id}`, supportedActions: ["generateContent"] };
          }
        })(),
      generateContent: (params: { model: string; config: { abortSignal: AbortSignal } }) => {
        fake.calls.push(params.model);
        if (fake.hanging.has(params.model)) {
          return new Promise((_, reject) => params.config.abortSignal.addEventListener("abort", () => reject(new DOMException("annule", "AbortError"))));
        }
        return Promise.resolve({ text: JSON.stringify(output), candidates: [{ finishReason: "STOP" }] });
      },
    };
  }
  return { ...actual, GoogleGenAI };
});

import { generatePublishKit } from "./generator";

const production = { title: "T", synopsis: "S", story: { hook: "H", punchline: "P" }, params: { language: "fr", comedyStyle: "mixed" as const }, characters: [] };
const request = { production, previous: null, model: "gemini-3.8-flash" };

describe("modeles trop lents", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    vi.useFakeTimers();
    fake.calls.length = 0;
    fake.hanging.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("n'attend plus un modele qui vient de bloquer, puis lui redonne sa chance apres 24 h", async () => {
    fake.hanging.add("gemini-3.8-flash");
    const first = generatePublishKit(request);
    await vi.advanceTimersByTimeAsync(31_000);
    expect((await first).model).toBe("gemini-3.5-flash-lite");
    expect(fake.calls).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);

    fake.calls.length = 0;
    expect((await generatePublishKit(request)).model).toBe("gemini-3.5-flash-lite");
    expect(fake.calls).toEqual(["gemini-3.5-flash-lite"]);

    fake.calls.length = 0;
    fake.hanging.clear();
    await vi.advanceTimersByTimeAsync(24 * 3_600_000 + 1_000);
    expect((await generatePublishKit(request)).model).toBe("gemini-3.8-flash");
  });
});
