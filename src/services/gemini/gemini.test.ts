import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import type { CharacterDetail, CharacterGeneration } from "@/types";
import { pickSupportingFruits } from "@/utils/catalog";
import { buildModelChain, fastThinkingLevel, type GeminiModelInfo } from "./client";
import { GeminiError, toGeminiError, type GeminiErrorCode } from "./errors";
import { composeCharacterModelSheetPrompt, composeFlowPrompt, finalizePublishKit } from "./flowPrompt";
import { composeClipInputs, runWithModelFallback } from "./generator";
import { buildCharacterPrompt, buildCharacterSystemInstruction, buildPublishPrompt, buildPublishSystemInstruction, buildStoryPrompt, buildSystemInstruction, characterSheet } from "./prompts";
import { characterJsonSchema, matchCharacterName, productionJsonSchema, validateCharacterIdentity, validatePublishCopy, validateStory, type GeneratedStory } from "./schemas";

const clip = (n: number, extra: Partial<GeneratedStory["clips"][number]> = {}) => ({
  clipNumber: n,
  duration: 8,
  sceneDescription: `Scène ${n}`,
  location: "Cuisine",
  charactersPresent: ["pomme", "Banane "],
  characterActions: [{ character: "POMME", description: "croise les bras" }],
  facialExpressions: [],
  cameraDirections: "Plan moyen vertical",
  dialogue: [{ character: "banane", line: "Tu m'as trahie !", delivery: "outrée" }],
  soundEffects: ["boing"],
  musicInstructions: "Même thème ukulélé, 110 BPM",
  continuityInstructions: "Pomme à gauche, Banane à droite",
  googleFlowPrompt: "Pomme stands on the left of the kitchen counter while Banane gasps dramatically on the right side.",
  ...extra,
});

const story = (clips = [clip(1), clip(2), clip(3)]) => ({
  title: "La trahison",
  synopsis: "Banane découvre tout.",
  hook: "Un cri dans la cuisine",
  punchline: "C'était une compote",
  targetDuration: 30,
  clipDuration: 10,
  language: "fr",
  selectedCharacters: ["Pomme", "Banane"],
  visualStyle: "Glossy 3D cartoon, warm kitchen light",
  globalVisualDirection: "Cuisine chaleureuse",
  globalAudioDirection: "Ukulélé joyeux 110 BPM",
  characterDescriptors: [
    { name: "pomme", visualDescriptor: "A shiny round red apple with big blue eyes and thin limbs", voiceDescriptor: "high-pitched diva" },
    { name: "Banane", visualDescriptor: "A tall curved yellow banana with a brown tip and a tiny bow tie", voiceDescriptor: "deep and calm" },
  ],
  clips,
});

const exp = { clipCount: 3, clipDuration: 10, characterNames: ["Pomme", "Banane"] };

describe("validateStory", () => {
  it("accepte une histoire conforme et normalise noms et durees", () => {
    const result = validateStory(story(), exp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.clips.map((c) => c.duration)).toEqual([10, 10, 10]);
    expect(result.data.clips[0].charactersPresent).toEqual(["Pomme", "Banane"]);
    expect(result.data.clips[0].dialogue[0].character).toBe("Banane");
    expect(result.data.characterDescriptors[0].name).toBe("Pomme");
  });

  it("refuse un nombre de clips incorrect", () => {
    const result = validateStory(story([clip(1), clip(2)]), exp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toMatch(/exactly 3 clips/);
  });

  it("remet les clips dans l'ordre de leur numero", () => {
    const result = validateStory(story([clip(2), clip(1), clip(3)]), exp);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.clips.map((c) => c.sceneDescription)).toEqual(["Scène 1", "Scène 2", "Scène 3"]);
  });

  it("refuse une numerotation trouee", () => {
    expect(validateStory(story([clip(1), clip(2), clip(4)]), exp).ok).toBe(false);
  });

  it("refuse un prompt Flow vide ou un champ manquant", () => {
    expect(validateStory(story([clip(1), clip(2), clip(3, { googleFlowPrompt: "court" })]), exp).ok).toBe(false);
    const broken = story() as Record<string, unknown>;
    delete broken.hook;
    expect(validateStory(broken, exp).ok).toBe(false);
  });
});

describe("matchCharacterName", () => {
  it("ignore casse, accents et espaces", () => {
    expect(matchCharacterName("  CLÉMENTINE ", ["Clementine"])).toBe("Clementine");
    expect(matchCharacterName("Kiwi", ["Pomme"])).toBeNull();
  });
});

describe("productionJsonSchema", () => {
  it("impose le nombre exact de clips", () => {
    const schema = productionJsonSchema(4);
    expect(schema.properties.clips.minItems).toBe(4);
    expect(schema.properties.clips.maxItems).toBe(4);
  });
});

describe("composeFlowPrompt", () => {
  const base = {
    clip: { clipNumber: 2, charactersPresent: ["Pomme"], googleFlowPrompt: "Scene body." },
    clipCount: 3,
    clipDuration: 10,
    visualStyle: "Glossy 3D cartoon",
    descriptors: [
      { name: "Pomme", visualDescriptor: "A shiny red apple.", voiceDescriptor: "Diva voice." },
      { name: "Banane", visualDescriptor: "A yellow banana.", voiceDescriptor: "" },
    ],
    promptLanguage: "en",
    storyLanguage: "fr",
    charactersWithReferences: ["Pomme"],
  };

  it("contient format vertical, duree, continuite, descripteur et langue", () => {
    const prompt = composeFlowPrompt(base);
    expect(prompt).toContain("Vertical 9:16");
    expect(prompt).toContain("exactly 10 seconds");
    expect(prompt).toContain("Clip 2 of 3");
    expect(prompt).toContain("continues seamlessly from the previous clip");
    expect(prompt).toContain("- Pomme: A shiny red apple. Voice: Diva voice.");
    expect(prompt).not.toContain("banana");
    expect(prompt).toContain("All spoken dialogue is in French");
    expect(prompt.endsWith("Scene body.")).toBe(true);
  });

  it("formule les references au conditionnel et sans URL", () => {
    const prompt = composeFlowPrompt(base);
    expect(prompt).toContain("If reference images of Pomme are provided");
    expect(prompt).not.toMatch(/https?:\/\//);
    expect(composeFlowPrompt({ ...base, charactersWithReferences: [] })).not.toContain("reference images");
  });

  it("existe en francais", () => {
    const prompt = composeFlowPrompt({ ...base, promptLanguage: "fr" });
    expect(prompt).toContain("Vidéo verticale 9:16");
    expect(prompt).toContain("Clip 2 sur 3");
  });
});

const character = (name: string, extra: Partial<CharacterDetail> = {}): CharacterDetail => ({
  id: name.toLowerCase(),
  name,
  species: "Fruit",
  shortDescription: "",
  personality: "Jaloux",
  behavior: "",
  voice: "Grave",
  mannerisms: "",
  appearance: "Jaune",
  distinctiveDetails: "",
  creativeNotes: "",
  color: "#B7F36B",
  coverImageId: null,
  archived: false,
  createdAt: "",
  updatedAt: "",
  coverPath: null,
  images: [],
  relationships: [],
  productions: [],
  status: "ready",
  activeGenerationId: null,
  generations: [],
  ...extra,
});

const identity = {
  canonicalVisual: "A tall bright-yellow banana with a slightly curved body, thin brown limbs and a simple friendly face.",
  canonicalVoice: "Deep, overly serious male voice.",
};

const version = (extra: Partial<CharacterGeneration> = {}): CharacterGeneration => ({
  id: "v1",
  characterId: "kevin",
  version: 1,
  instruction: "",
  model: "gemini-test",
  brief: {},
  identity: { ...identity, promptLanguage: "en" },
  prompts: [],
  createdAt: "",
  updatedAt: "",
  ...extra,
});

const modelInfo = (id: string): GeminiModelInfo => ({ id, displayName: id, description: "", inputTokenLimit: null, outputTokenLimit: null, thinking: false });

describe("detection des modeles", () => {
  it("garde le modele choisi en tete s'il est disponible", () => {
    expect(buildModelChain("b", [modelInfo("a"), modelInfo("b"), modelInfo("c")])).toEqual(["b", "a", "c"]);
  });

  it("ignore un modele absent et plafonne le nombre d'essais", () => {
    expect(buildModelChain("x", ["a", "b", "c", "d", "e"].map(modelInfo))).toEqual(["a", "b", "c", "d"]);
  });

  it("conserve le modele choisi si la liste est vide", () => {
    expect(buildModelChain("x", [])).toEqual(["x"]);
  });
});

describe("runWithModelFallback", () => {
  const fail = (code: GeminiErrorCode) => () => Promise.reject(new GeminiError(code, code));

  it("passe au suivant si le modele est absent, a court de quota ou sature", async () => {
    const attempts: string[] = [];
    const switches: string[] = [];
    const errors: Record<string, () => Promise<string>> = { a: fail("model_not_found"), b: fail("quota"), c: fail("overloaded"), d: () => Promise.resolve("ok") };
    const result = await runWithModelFallback(
      ["a", "b", "c", "d"],
      (model) => {
        attempts.push(model);
        return errors[model]();
      },
      (from, to) => switches.push(`${from}>${to}`),
    );
    expect(result).toEqual({ data: "ok", model: "d" });
    expect(attempts).toEqual(["a", "b", "c", "d"]);
    expect(switches).toEqual(["a>b", "b>c", "c>d"]);
  });

  it("n'insiste pas sur une erreur independante du modele", async () => {
    const attempts: string[] = [];
    await expect(
      runWithModelFallback(["a", "b"], (model) => {
        attempts.push(model);
        return fail("invalid_key")();
      }),
    ).rejects.toMatchObject({ code: "invalid_key" });
    expect(attempts).toEqual(["a"]);
  });

  it("n'essaie jamais deux fois le meme modele et explique l'echec final", async () => {
    const attempts: string[] = [];
    await expect(
      runWithModelFallback(["a", "b"], (model) => {
        attempts.push(model);
        return fail("quota")();
      }),
    ).rejects.toMatchObject({ code: "quota", message: expect.stringContaining("Aucun des 2 modèles") });
    expect(attempts).toEqual(["a", "b"]);
  });

  it("s'arrete si l'utilisateur annule", async () => {
    const controller = new AbortController();
    const attempts: string[] = [];
    await expect(
      runWithModelFallback(
        ["a", "b"],
        (model) => {
          attempts.push(model);
          controller.abort();
          return fail("overloaded")();
        },
        undefined,
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(GeminiError);
    expect(attempts).toEqual(["a"]);
  });
});

describe("generation d'un personnage", () => {
  it("accepte la reponse courte attendue", () => {
    expect(validateCharacterIdentity(identity).ok).toBe(true);
  });

  it("refuse une description absente ou trop courte", () => {
    expect(validateCharacterIdentity({ canonicalVoice: "x" }).ok).toBe(false);
    expect(validateCharacterIdentity({ canonicalVisual: "banane", canonicalVoice: "x" }).ok).toBe(false);
  });

  it("demande seulement deux champs a Gemini", () => {
    expect(characterJsonSchema.required).toEqual(["canonicalVisual", "canonicalVoice"]);
  });

  const prompt = composeCharacterModelSheetPrompt({ name: "Kevin", canonicalVisual: identity.canonicalVisual, promptLanguage: "en" });

  it("demande une seule image avec les trois vues", () => {
    expect(prompt).toContain("One single 16:9 landscape image");
    expect(prompt).toContain("front view");
    expect(prompt).toContain("three-quarter view");
    expect(prompt).toContain("side profile view");
    expect(prompt).toContain("light gray");
  });

  it("reprend la description et n'ajoute rien", () => {
    expect(prompt).toContain(identity.canonicalVisual);
    expect(prompt).toContain("Do not add anything that is not described above");
    expect(prompt).not.toContain("http");
  });

  it("existe en francais", () => {
    expect(composeCharacterModelSheetPrompt({ name: "Kevin", canonicalVisual: identity.canonicalVisual, promptLanguage: "fr" })).toContain("vue de trois-quarts");
  });

  it("interdit d'inventer vetements et accessoires", () => {
    expect(buildCharacterSystemInstruction({ language: "fr", promptLanguage: "en" })).toContain("Do NOT invent clothing, accessories");
  });

  it("impose le brief et ne reprend la version precedente que pour un changement precis", () => {
    const brief = { name: "Kevin", species: "Banane", shortDescription: "Avec des lunettes", personality: "Arrogant", voice: "Grave" };
    const fresh = buildCharacterPrompt({ brief, olderNotes: {}, instruction: "", previous: identity });
    expect(fresh).toContain("Avec des lunettes");
    expect(fresh).not.toContain("CURRENT VERSION");
    const iteration = buildCharacterPrompt({ brief, olderNotes: {}, instruction: "Lunettes rondes", previous: identity });
    expect(iteration).toContain("CURRENT VERSION");
    expect(iteration).toContain("Lunettes rondes");
  });

  it("transmet l'apparence de l'ancienne fiche", () => {
    const brief = { name: "Pomme", species: "Pomme", shortDescription: "", personality: "", voice: "" };
    expect(buildCharacterPrompt({ brief, olderNotes: { appearance: "Tache dorée" }, instruction: "", previous: null })).toContain("Tache dorée");
  });
});

describe("fiche transmise aux histoires", () => {
  it("garde les champs de l'ancienne fiche sans version generee", () => {
    const sheet = characterSheet(character("Pomme", { appearance: "Ronde" }), new Set(["pomme"]));
    expect(sheet).toContain("Physical appearance: Ronde");
    expect(sheet).not.toContain("Canonical visual descriptor");
  });

  it("utilise la version active quand elle existe", () => {
    const sheet = characterSheet(character("Kevin", { appearance: "Ancienne", activeGenerationId: "v1", generations: [version()] }), new Set(["kevin"]));
    expect(sheet).toContain(`Canonical visual descriptor: ${identity.canonicalVisual}`);
    expect(sheet).toContain(`Voice descriptor: ${identity.canonicalVoice}`);
    expect(sheet).toContain("Physical appearance: Ancienne");
  });

  it("lit encore une version de l'ancien format detaille", () => {
    const older = { ...identity, summary: "Ancien", physicalTraits: ["Courbé"], promptLanguage: "en" };
    const sheet = characterSheet(character("Kevin", { activeGenerationId: "v1", generations: [version({ identity: older as never })] }), new Set(["kevin"]));
    expect(sheet).toContain(identity.canonicalVisual);
  });

  it("ignore une version illisible sans casser la fiche", () => {
    const sheet = characterSheet(character("Kevin", { appearance: "Ronde", activeGenerationId: "v1", generations: [version({ identity: {} })] }), new Set(["kevin"]));
    expect(sheet).toContain("Physical appearance: Ronde");
  });
});

describe("prompts", () => {
  it("la consigne systeme impose les regles de duree et de langue", () => {
    const sys = buildSystemInstruction({ clipDuration: 8, language: "fr", promptLanguage: "en", musicMode: "flow" });
    expect(sys).toContain("exactly 8 seconds");
    expect(sys).toContain("Dialogue lines stay verbatim in French");
    expect(sys).toContain("never claim that images are attached");
    expect(sys).toContain("without restarting");
  });

  it("le mode musique au montage demande des clips sans musique", () => {
    expect(buildSystemInstruction({ clipDuration: 10, language: "fr", promptLanguage: "en", musicMode: "post" })).toContain("No background music");
  });

  it("le prompt utilisateur precise histoire independante et nombre de clips", () => {
    const prompt = buildStoryPrompt({
      characters: [character("Pomme"), character("Banane")],
      storyIdea: "",
      comedyStyle: "betrayal",
      targetDuration: 30,
      clipDuration: 10,
      clipCount: 3,
      language: "fr",
      promptLanguage: "en",
      musicMode: "flow",
      additionalInstructions: "",
      continuity: null,
    });
    expect(prompt).toContain("EXACTLY 3");
    expect(prompt).toContain("STANDALONE STORY");
    expect(prompt).toContain("invent an original");
    expect(prompt).toContain("### CHARACTER: Banane");
  });

  it("les relations ne sont transmises qu'entre personnages selectionnes", () => {
    const pomme = character("Pomme", {
      relationships: [
        { id: "1", direction: "outgoing", characterId: "pomme", relatedCharacterId: "banane", relatedName: "Banane", relatedSpecies: "", relatedColor: "", relatedCoverPath: null, relation: "Rivale", description: "" },
        { id: "2", direction: "outgoing", characterId: "pomme", relatedCharacterId: "kiwi", relatedName: "Kiwi", relatedSpecies: "", relatedColor: "", relatedCoverPath: null, relation: "Ex", description: "" },
      ],
    });
    const sheet = characterSheet(pomme, new Set(["pomme", "banane"]));
    expect(sheet).toContain("Pomme → Banane: Rivale");
    expect(sheet).not.toContain("Kiwi");
  });
});

describe("composeClipInputs", () => {
  it("produit un prompt final par clip avec le bon total", () => {
    const result = validateStory(story(), exp);
    if (!result.ok) throw new Error("fixture invalide");
    const inputs = composeClipInputs({
      clips: result.data.clips,
      clipDuration: 10,
      story: { ...result.data, hook: "", punchline: "" },
      promptLanguage: "en",
      storyLanguage: "fr",
      characters: [{ name: "Pomme", images: [] }, { name: "Banane", images: [] }],
    });
    expect(inputs).toHaveLength(3);
    expect(inputs[2].flowPrompt).toContain("Clip 3 of 3");
    expect(inputs[0].flowPrompt).toContain("A tall curved yellow banana");
  });
});

describe("toGeminiError", () => {
  it("reconnait un quota par minute avec delai", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded",
        details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "33s" }],
      },
    });
    const e = toGeminiError(new ApiError({ message: body, status: 429 }));
    expect(e.code).toBe("quota");
    expect(e.retryAfterSeconds).toBe(33);
    expect(e.dailyQuota).toBe(false);
  });

  it("reconnait un quota journalier", () => {
    const body = JSON.stringify({ error: { code: 429, message: "x", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } });
    const e = toGeminiError(new ApiError({ message: body, status: 429 }));
    expect(e.dailyQuota).toBe(true);
    expect(e.message).toMatch(/minuit/);
  });

  it("reconnait cle absente, cle invalide et modele introuvable", () => {
    expect(toGeminiError(new ApiError({ message: JSON.stringify({ error: { status: "NO_API_KEY", message: "x" } }), status: 401 })).code).toBe("no_key");
    expect(toGeminiError(new ApiError({ message: '{"error":{"message":"API key not valid. Please pass a valid API key."}}', status: 400 })).code).toBe("invalid_key");
    expect(toGeminiError(new ApiError({ message: "{}", status: 404 })).code).toBe("model_not_found");
  });

  it("reconnait un modele incompatible", () => {
    expect(toGeminiError(new ApiError({ message: '{"error":{"message":"JSON mode is not supported for this model"}}', status: 400 })).code).toBe("model_unsupported");
  });

  it("reconnait une erreur reseau de la passerelle Rust", () => {
    expect(toGeminiError({ kind: "network", message: "Hors ligne" }).code).toBe("network");
  });
});

describe("personnages inventes", () => {
  const zozo = { name: "Zozo", fruit: "Fraise", visualDescriptor: "A small glossy red strawberry with a simple expressive face and thin limbs", voiceDescriptor: "Squeaky and mocking" };
  const scene = clip(1, { charactersPresent: ["Pomme", "zozo"], dialogue: [{ character: "ZOZO", line: "Attrape-moi !", delivery: "moqueur" }] });
  const expSupporting = { ...exp, supportingCount: 1 };

  it("garde les fruits inventes dans les clips", () => {
    const result = validateStory({ ...story([scene, clip(2), clip(3)]), supportingCharacters: [zozo] }, expSupporting);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.clips[0].charactersPresent).toEqual(["Pomme", "Zozo"]);
    expect(result.data.clips[0].dialogue[0].character).toBe("Zozo");
  });

  it("refuse une histoire sans les fruits demandes", () => {
    const result = validateStory(story(), expSupporting);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toContain("supportingCharacters");
  });

  it("refuse des fruits inventes jamais presents a l'ecran", () => {
    expect(validateStory({ ...story(), supportingCharacters: [zozo] }, expSupporting).ok).toBe(false);
  });

  it("refuse un nom deja pris par le casting", () => {
    const homonyme = { ...zozo, name: "Pomme" };
    expect(validateStory({ ...story([scene, clip(2), clip(3)]), supportingCharacters: [homonyme] }, expSupporting).ok).toBe(false);
  });

  it("decrit le fruit invente dans le prompt video", () => {
    const result = validateStory({ ...story([scene, clip(2), clip(3)]), supportingCharacters: [zozo] }, expSupporting);
    if (!result.ok) throw new Error("fixture invalide");
    const inputs = composeClipInputs({
      clips: result.data.clips,
      clipDuration: 10,
      story: { ...result.data, hook: "", punchline: "", characterDescriptors: [...result.data.characterDescriptors, zozo] },
      promptLanguage: "en",
      storyLanguage: "fr",
      characters: [{ name: "Pomme", images: [] }],
    });
    expect(inputs[0].flowPrompt).toContain("- Zozo: A small glossy red strawberry");
    expect(inputs[1].flowPrompt).not.toContain("strawberry");
  });

  it("demande les fruits inventes seulement si l'option est cochee", () => {
    const withOption = productionJsonSchema(3, 2);
    expect(withOption.required).toContain("supportingCharacters");
    expect((withOption.properties as Record<string, { minItems?: number }>).supportingCharacters.minItems).toBe(2);
    expect(productionJsonSchema(3).required).not.toContain("supportingCharacters");
  });

  const base = { clipDuration: 10, language: "fr", promptLanguage: "en", musicMode: "flow" } as const;

  it("impose les fruits tires au sort et l'interaction", () => {
    const sys = buildSystemInstruction({ ...base, supportingFruits: ["kiwi", "mango"] });
    expect(sys).toContain("kiwi, mango");
    expect(sys).toContain("cat-and-mouse");
    expect(sys).toContain("at least two characters");
    expect(sys).toContain("no clothing or accessories");
    expect(sys).not.toContain("stay silent");
  });

  it("garde le casting seul sans l'option", () => {
    const sys = buildSystemInstruction(base);
    expect(sys).toContain("stay silent");
    expect(sys).not.toContain("cat-and-mouse");
  });

  it("n'invente personne de plus en regenerant un clip", () => {
    const sys = buildSystemInstruction({ ...base, existingSupporting: [zozo] });
    expect(sys).toContain("do not invent others");
    expect(sys).toContain("- Zozo: A small glossy");
  });

  it("tire des fruits differents et absents du casting", () => {
    const drawn = pickSupportingFruits(3, ["Banane", "Kiwi vert"], () => 0.5);
    expect(drawn).toHaveLength(3);
    expect(new Set(drawn).size).toBe(3);
    expect(drawn).not.toContain("banana");
    expect(drawn).not.toContain("kiwi");
  });
});

describe("texte de publication", () => {
  const copy = {
    tiktokCaption: "Kevin se croit le plus malin #fyp, qui a raison ?",
    tiktokHashtags: ["#Humour", "dessin animé", "humour", "fruits", "Kiwi!", "cartoon", "extra"],
    youtubeTitle: "Une banane contre tout le verger #shorts",
    youtubeDescription: "Kevin déclare la guerre au compotier.",
    youtubeHashtags: ["banane", "#Humour", "animation", "fruits"],
  };

  it("met le texte en forme, quelle que soit la reponse", () => {
    const kit = finalizePublishKit(copy, "gemini-test");
    expect(kit.tiktok).toBe("Kevin se croit le plus malin, qui a raison ?\n\n#humour #dessinanime #fruits #kiwi #cartoon");
    expect(kit.youtubeTitle).toBe("Une banane contre tout le verger");
    expect(kit.youtubeDescription).toBe("Kevin déclare la guerre au compotier.\n\n#shorts #banane #humour #animation");
  });

  it("respecte la limite de titre de YouTube sans couper un mot", () => {
    const { youtubeTitle } = finalizePublishKit({ ...copy, youtubeTitle: "mot ".repeat(40) }, "x");
    expect(youtubeTitle.length).toBeLessThanOrEqual(100);
    expect(youtubeTitle.endsWith("mot")).toBe(true);
  });

  it("refuse une reponse incomplete", () => {
    expect(validatePublishCopy(copy).ok).toBe(true);
    expect(validatePublishCopy({ ...copy, tiktokCaption: "" }).ok).toBe(false);
  });

  const source = { title: "La poursuite", synopsis: "Une banane fuit.", story: { hook: "Un cri", punchline: "C'etait un piege", supportingCharacters: [{ name: "Zozo", fruit: "Fraise" }] }, params: { comedyStyle: "mixed" as const }, characters: [{ id: "1", name: "Kevin", species: "Banane", color: "#fff", coverPath: null, archived: false }] };

  it("vise la portee sans reveler la chute ni reclamer de likes", () => {
    const sys = buildPublishSystemInstruction("fr");
    expect(sys).toContain("never reveal the punchline");
    expect(sys).toContain("no requests for likes");
    expect(sys).toContain("write everything in French");
    expect(buildPublishPrompt(source, null)).toContain("Punchline (do NOT reveal it): C'etait un piege");
    expect(buildPublishPrompt(source, null)).toContain("Zozo (Fraise)");
  });

  it("demande un autre angle pour une nouvelle proposition", () => {
    const previous = { tiktok: "Ancien texte", youtubeTitle: "Ancien titre", youtubeDescription: "", model: "x" };
    expect(buildPublishPrompt(source, previous)).toContain("Ancien texte");
    expect(buildPublishPrompt(source, null)).not.toContain("PREVIOUS PROPOSAL");
  });
});

describe("generations plus rapides", () => {
  it("reflechit peu sur les modeles qui le permettent", () => {
    expect(fastThinkingLevel("gemini-3.8-flash")).toBe("LOW");
    expect(fastThinkingLevel("gemini-4-argon")).toBe("LOW");
  });

  it("ne touche pas aux modeles deja rapides ou sans ce reglage", () => {
    expect(fastThinkingLevel("gemini-3.5-flash-lite")).toBeNull();
    expect(fastThinkingLevel("gemini-2.5-flash")).toBeNull();
  });

  it("garde le modele choisi et propose un Flash-Lite juste apres", () => {
    const models = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash-lite"].map(modelInfo);
    expect(buildModelChain("gemini-3.8-flash", models)).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.7-flash"]);
    expect(buildModelChain("gemini-3.8-flash", models, (id) => id !== "gemini-3.5-flash-lite")).toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash"]);
  });

  it("arrete d'essayer d'autres modeles une fois le temps ecoule", async () => {
    const attempts: string[] = [];
    await expect(
      runWithModelFallback(
        ["a", "b", "c"],
        (model) => {
          attempts.push(model);
          return Promise.reject(new GeminiError("timeout", "trop long"));
        },
        undefined,
        undefined,
        Date.now() - 1,
      ),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(attempts).toEqual(["a"]);
  });
});
