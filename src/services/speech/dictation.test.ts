import { describe, expect, it, vi } from "vitest";

vi.mock("vosk-browser", () => ({ createModel: vi.fn() }));

import { formatSentence } from "./dictation";

describe("formatSentence", () => {
  it("ajoute la majuscule et le point", () => {
    expect(formatSentence("une banane ridicule")).toBe("Une banane ridicule.");
    expect(formatSentence("  élégante  ")).toBe("Élégante.");
  });

  it("ignore une phrase vide", () => {
    expect(formatSentence("   ")).toBe("");
  });
});
