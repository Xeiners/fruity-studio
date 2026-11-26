/** Documents texte generes a partir d'une production (copie / export). */
import { parseClipContent } from "@/services/gemini/schemas";
import type { ProductionDetail } from "@/types";
import { comedyStyle } from "@/utils/catalog";

export function allPromptsText(p: ProductionDetail): string {
  return p.clips
    .map((c) => `=== CLIP ${c.clipNumber}/${p.clips.length} — ${c.duration} s ===\n${c.flowPrompt.trim()}`)
    .join("\n\n");
}

export function productionMarkdown(p: ProductionDetail): string {
  const story = p.story;
  const lines: string[] = [
    `# ${p.title}`,
    "",
    `- Durée : ${p.clips.length} clips × ${p.clipDuration} s`,
    `- Personnages : ${p.characters.map((c) => `${c.name} (${c.species})`).join(", ")}`,
    `- Style : ${comedyStyle(p.params.comedyStyle).label}`,
    "",
    "## Synopsis",
    p.synopsis,
    "",
  ];
  if (story.hook) lines.push(`**Accroche :** ${story.hook}`, "");
  if (story.punchline) lines.push(`**Chute :** ${story.punchline}`, "");
  if (story.globalVisualDirection) lines.push("## Direction visuelle", story.globalVisualDirection, "");
  if (story.globalAudioDirection) lines.push("## Direction audio", story.globalAudioDirection, "");
  for (const clip of p.clips) {
    const content = parseClipContent(clip.content);
    lines.push(`## Clip ${clip.clipNumber} — ${clip.duration} s`, "");
    if (content) {
      lines.push(content.sceneDescription, "");
      if (content.dialogue.length) {
        lines.push("**Dialogues**", ...content.dialogue.map((d) => `- ${d.character} : « ${d.line} »${d.delivery ? ` (${d.delivery})` : ""}`), "");
      }
      if (content.soundEffects.length) lines.push(`**Effets sonores :** ${content.soundEffects.join(" · ")}`, "");
      lines.push(`**Musique :** ${content.musicInstructions}`, "", `**Continuité :** ${content.continuityInstructions}`, "");
    }
    lines.push("**Prompt Google Flow**", "", "```", clip.flowPrompt.trim(), "```", "");
  }
  return lines.join("\n");
}
