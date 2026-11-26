import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Save, Sparkles } from "lucide-react";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { InlineNotice } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, Kbd } from "@/components/ui/display";
import { openSetup } from "@/features/setup/setupStore";
import { invalidate, useKeyStatus } from "@/hooks/queries";
import { useHotkeys } from "@/hooks/useHotkeys";
import { charactersApi } from "@/services/storage/characters";
import { characterColorFor } from "@/utils/catalog";
import { notifyError, notifySuccess } from "@/utils/notify";
import { startCharacterGeneration } from "./characterGenerationStore";
import { EMPTY_ESSENTIALS, EssentialsFields, essentialsOf, validateEssentials, type EssentialsErrors } from "./EssentialsFields";

/** Creation d'un personnage : cinq champs, puis tout se poursuit dans sa fiche. */
export function CharacterFormPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: key } = useKeyStatus();
  const [form, setForm] = useState(EMPTY_ESSENTIALS);
  const [errors, setErrors] = useState<EssentialsErrors>({});
  const [busy, setBusy] = useState<"draft" | "generate" | null>(null);

  const create = async (mode: "draft" | "generate") => {
    if (busy) return;
    const nextErrors = validateEssentials(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    if (mode === "generate" && key && !key.configured) {
      openSetup();
      return;
    }
    setBusy(mode);
    try {
      const brief = essentialsOf(form);
      const saved = await charactersApi.create({ ...brief, color: characterColorFor(brief.name) });
      invalidate(client, "characters", "stats");
      if (mode === "generate") void startCharacterGeneration({ character: saved, brief, instruction: "", previous: null });
      else notifySuccess("Brouillon enregistré", "Vous pourrez générer le personnage quand vous voudrez.");
      navigate(`/characters/${saved.id}`, { replace: true });
    } catch (error) {
      notifyError(error, "Enregistrement impossible");
      setBusy(null);
    }
  };

  useHotkeys([
    { combo: "mod+enter", handler: () => void create("generate"), allowInInputs: true },
    { combo: "mod+s", handler: () => void create("draft"), allowInInputs: true },
  ]);

  return (
    <Page className="max-w-[760px]">
      <PageHeader
        back={{ to: "/characters", label: "Personnages" }}
        title="Nouveau personnage"
        description="Décrivez l'essentiel : Gemini écrit le prompt à coller dans Google Flow."
      />

      {key && !key.configured && (
        <InlineNotice
          tone="warning"
          icon={KeyRound}
          title="Clé API Gemini manquante"
          action={
            <Button size="xs" variant="outline" onClick={openSetup}>
              Saisir la clé
            </Button>
          }
        >
          Elle est nécessaire pour générer le personnage. Vous pouvez déjà l'enregistrer en brouillon.
        </InlineNotice>
      )}

      <Card className="flex flex-col gap-6 p-6">
        <EssentialsFields
          value={form}
          errors={errors}
          autoFocus
          onChange={(field, value) => {
            setForm((f) => ({ ...f, [field]: value }));
            setErrors((e) => ({ ...e, [field]: undefined }));
          }}
        />
        <div className="flex flex-col items-end gap-2.5 border-t border-border pt-5">
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="lg" onClick={() => void create("draft")} loading={busy === "draft"} disabled={busy !== null}>
              <Save /> Enregistrer en brouillon
            </Button>
            <Button size="lg" onClick={() => void create("generate")} loading={busy === "generate"} disabled={busy !== null}>
              {busy !== "generate" && <Sparkles />} Générer mon personnage
            </Button>
          </div>
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <Kbd>Ctrl Entrée</Kbd> · consomme 1 requête Gemini (2 si correction)
          </span>
        </div>
      </Card>
    </Page>
  );
}
