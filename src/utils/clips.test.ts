import { describe, expect, it } from "vitest";
import { computeClipCount, detectClipNumber, totalDuration } from "./clips";

describe("computeClipCount", () => {
  it("30 s en clips de 10 s = 3 clips", () => {
    expect(computeClipCount(30, 10)).toBe(3);
    expect(totalDuration(30, 10)).toBe(30);
  });
  it("arrondit au clip superieur", () => {
    expect(computeClipCount(30, 8)).toBe(4);
    expect(computeClipCount(25, 10)).toBe(3);
  });
  it("au moins un clip, au plus 12", () => {
    expect(computeClipCount(5, 10)).toBe(1);
    expect(computeClipCount(600, 4)).toBe(12);
  });
});

describe("detectClipNumber", () => {
  it("reconnait les noms courants", () => {
    expect(detectClipNumber("clip_2.mp4")).toBe(2);
    expect(detectClipNumber("Clip 03 final.mov")).toBe(3);
    expect(detectClipNumber("plan-1.mp4")).toBe(1);
    expect(detectClipNumber("Scène3.mp4")).toBe(3);
    expect(detectClipNumber("pomme-banane-partie 2.mp4")).toBe(2);
  });
  it("ignore les noms sans numero explicite", () => {
    expect(detectClipNumber("flow_8a7c2d.mp4")).toBeNull();
    expect(detectClipNumber("video 2025.mp4")).toBeNull();
    expect(detectClipNumber("clip2025.mp4")).toBeNull();
  });
});
