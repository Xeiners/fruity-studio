import { useState } from "react";
import { Link } from "react-router";
import { Pencil } from "lucide-react";
import { CharacterAvatar } from "@/components/common/media";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import type { CharacterDescriptor, StoryContent } from "@/services/gemini/schemas";
import type { ProductionDetail } from "@/types";
import { characterColorFor, comedyStyle, language } from "@/utils/catalog";

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-eyebrow">{label}</p>
      <div className="text-[13px] leading-relaxed" data-selectable>
        {children}
      </div>
    </div>
  );
}

export interface StoryEdit {
  title: string;
  synopsis: string;
  story: Partial<StoryContent>;
}

function StoryEditDialog({ production, onClose, onSave }: { production: ProductionDetail; onClose: () => void; onSave: (edit: StoryEdit) => Promise<void> }) {
  const s = production.story;
  const [title, setTitle] = useState(production.title);
  const [synopsis, setSynopsis] = useState(production.synopsis);
  const [hook, setHook] = useState(s.hook ?? "");
  const [punchline, setPunchline] = useState(s.punchline ?? "");
  const [visualStyle, setVisualStyle] = useState(s.visualStyle ?? "");
  const [visual, setVisual] = useState(s.globalVisualDirection ?? "");
  const [audio, setAudio] = useState(s.globalAudioDirection ?? "");
  const [descriptors, setDescriptors] = useState<CharacterDescriptor[]>(s.characterDescriptors ?? []);
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modifier l'histoire</DialogTitle>
          <DialogDescription>
            Le style visuel et les descripteurs sont répétés mot pour mot dans chaque prompt : les modifier recompose les prompts non retouchés à la main.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Titre">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Synopsis">
            <Textarea value={synopsis} onChange={(e) => setSynopsis(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Accroche">
              <Textarea value={hook} onChange={(e) => setHook(e.target.value)} />
            </Field>
            <Field label="Chute">
              <Textarea value={punchline} onChange={(e) => setPunchline(e.target.value)} />
            </Field>
          </div>
          <Field label="Direction visuelle">
            <Textarea value={visual} onChange={(e) => setVisual(e.target.value)} />
          </Field>
          <Field label="Direction audio">
            <Textarea value={audio} onChange={(e) => setAudio(e.target.value)} />
          </Field>
          <Field label="Style visuel (repris dans chaque prompt)">
            <Input value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)} />
          </Field>
          {descriptors.map((d, i) => (
            <Field key={d.name} label={`Descripteur visuel — ${d.name}`}>
              <Textarea
                value={d.visualDescriptor}
                onChange={(e) => setDescriptors(descriptors.map((x, j) => (j === i ? { ...x, visualDescriptor: e.target.value } : x)))}
                className="font-mono text-[12px]"
              />
            </Field>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={saving}
            disabled={!title.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  title,
                  synopsis,
                  story: { ...s, hook, punchline, visualStyle, globalVisualDirection: visual, globalAudioDirection: audio, characterDescriptors: descriptors },
                });
                onClose();
              } catch {
                // erreur deja notifiee ; la boite reste ouverte
              } finally {
                setSaving(false);
              }
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StoryOverview({ production, onSave }: { production: ProductionDetail; onSave: (edit: StoryEdit) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const s = production.story;
  const p = production.params;
  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[13.5px] font-semibold">L'histoire</h2>
        <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
          <Pencil /> Modifier
        </Button>
      </div>
      <Block label="Synopsis">{production.synopsis || "—"}</Block>
      {(s.hook || s.punchline) && (
        <div className="grid gap-3">
          {s.hook && (
            <div className="rounded-lg border border-primary/25 bg-lime-soft px-3 py-2.5">
              <p className="text-eyebrow !text-primary-strong">Accroche</p>
              <p className="mt-1 text-[12.5px] leading-relaxed" data-selectable>
                {s.hook}
              </p>
            </div>
          )}
          {s.punchline && (
            <div className="rounded-lg border border-orange/25 bg-orange-soft px-3 py-2.5">
              <p className="text-eyebrow !text-orange">Chute</p>
              <p className="mt-1 text-[12.5px] leading-relaxed" data-selectable>
                {s.punchline}
              </p>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-eyebrow">Personnages</p>
        <div className="flex flex-col gap-1">
          {production.characters.map((c) => (
            <Link key={c.id} to={`/characters/${c.id}`} className="flex items-center gap-2.5 rounded-md p-1.5 transition-colors hover:bg-accent/60">
              <CharacterAvatar name={c.name} species={c.species} color={c.color} coverPath={c.coverPath} size={28} />
              <span className="text-[13px] font-medium">{c.name}</span>
              <span className="truncate text-[12px] text-muted-foreground">{c.species}</span>
            </Link>
          ))}
          {s.supportingCharacters?.map((c) => (
            <div key={c.name} className="flex items-center gap-2.5 p-1.5">
              <CharacterAvatar name={c.name} species={c.fruit} color={characterColorFor(c.name)} coverPath={null} size={28} />
              <span className="text-[13px] font-medium">{c.name}</span>
              <span className="truncate text-[12px] text-muted-foreground">{c.fruit}</span>
              <Badge variant="outline" className="ml-auto">
                Inventé
              </Badge>
            </div>
          ))}
        </div>
      </div>
      {s.globalVisualDirection && <Block label="Direction visuelle">{s.globalVisualDirection}</Block>}
      {s.globalAudioDirection && <Block label="Direction audio">{s.globalAudioDirection}</Block>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-4 text-[11.5px] text-muted-foreground">
        <span>{comedyStyle(p.comedyStyle).label}</span>
        <span>Dialogues : {language(p.language).label}</span>
        <span>Prompts : {p.promptLanguage === "story" ? language(p.language).label : "anglais"}</span>
        <span>Musique : {p.musicMode === "post" ? "au montage" : "par Flow"}</span>
        {p.model && <span className="font-mono">{p.model}</span>}
      </div>
      {editing && <StoryEditDialog production={production} onClose={() => setEditing(false)} onSave={onSave} />}
    </Card>
  );
}
