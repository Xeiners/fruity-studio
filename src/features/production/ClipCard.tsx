import { useState } from "react";
import { Camera, FileVideo, MapPin, MessageSquareQuote, MoreHorizontal, Music2, Pencil, RefreshCw, Replace, Sparkles, Trash2, Volume2, Waypoints } from "lucide-react";
import { CopyButton } from "@/components/common/CopyButton";
import { AvatarStack } from "@/components/common/media";
import { Button } from "@/components/ui/button";
import { Badge, Card, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/display";
import { Textarea } from "@/components/ui/form-controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from "@/components/ui/menus";
import { estimateTokens } from "@/services/gemini/flowPrompt";
import { parseClipContent, type CharacterBeat } from "@/services/gemini/schemas";
import type { CharacterRef, Clip, ProductionDetail } from "@/types";
import { cn } from "@/utils/cn";
import { padClip } from "@/utils/format";
import { CLIP_STATE_LABEL, CLIP_STATE_TONE, clipState } from "@/utils/status";
import { ClipVideoSlot } from "./ClipVideoSlot";

function Beats({ items }: { items: CharacterBeat[] }) {
  if (!items.length) return <p className="text-muted-foreground">—</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((b, i) => (
        <li key={i}>
          <span className="font-medium">{b.character}</span> <span className="text-muted-foreground">— {b.description}</span>
        </li>
      ))}
    </ul>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: typeof Camera; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[22px_minmax(0,1fr)] gap-2">
      <Icon className="mt-0.5 size-3.5 text-muted-foreground" />
      <div>
        <p className="text-eyebrow">{label}</p>
        <div className="mt-1 text-[13px] leading-relaxed" data-selectable>
          {children}
        </div>
      </div>
    </div>
  );
}

export interface ClipCardProps {
  clip: Clip;
  production: ProductionDetail;
  busy: boolean;
  regenerating: boolean;
  onImport: () => void;
  onDropFile: (path: string) => void;
  onRemoveVideo: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onSavePrompt: (prompt: string) => Promise<void>;
  onResetPrompt: () => Promise<void>;
}

export function ClipCard({ clip, production, busy, regenerating, onImport, onDropFile, onRemoveVideo, onEdit, onRegenerate, onSavePrompt, onResetPrompt }: ClipCardProps) {
  const content = parseClipContent(clip.content);
  const state = clipState(clip, production);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(clip.flowPrompt);
  const [saving, setSaving] = useState(false);
  const present: CharacterRef[] = content
    ? content.charactersPresent
        .map((name) => production.characters.find((c) => c.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0))
        .filter((c): c is CharacterRef => Boolean(c))
    : [];
  const tokens = estimateTokens(clip.flowPrompt);
  const isLast = clip.clipNumber === production.clips.length;

  return (
    <Card id={`clip-${clip.clipNumber}`} className={cn("scroll-mt-24 overflow-hidden transition-opacity", regenerating && "opacity-60")}>
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <span className="font-mono text-[22px] leading-none font-medium tracking-tight text-muted-foreground/70">{padClip(clip.clipNumber)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold">Clip {clip.clipNumber}</h3>
            <span className="font-mono text-[11.5px] text-muted-foreground">{clip.duration} s</span>
            {clip.clipNumber === 1 && <Badge variant="lime">Accroche</Badge>}
            {isLast && production.clips.length > 1 && <Badge variant="orange">Chute</Badge>}
            <Badge variant={CLIP_STATE_TONE[state]} dot>
              {CLIP_STATE_LABEL[state]}
            </Badge>
          </div>
        </div>
        {present.length > 0 && <AvatarStack characters={present} size={24} />}
        <CopyButton text={clip.flowPrompt} label="Copier le prompt" size="sm" toastMessage={`Prompt du clip ${clip.clipNumber} copié — collez-le dans Google Flow`} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions du clip ${clip.clipNumber}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => { setDraft(clip.flowPrompt); setEditing(true); }}>
              <Pencil /> Modifier le prompt
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Modifier le clip…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRegenerate}>
              <Sparkles /> Régénérer ce clip…
            </DropdownMenuItem>
            {clip.promptEdited && (
              <DropdownMenuItem onSelect={() => void onResetPrompt()}>
                <RefreshCw /> Recomposer le prompt d'origine
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onImport}>
              {clip.video ? <Replace /> : <FileVideo />} {clip.video ? "Remplacer la vidéo…" : "Importer la vidéo…"}
            </DropdownMenuItem>
            <DropdownMenuItem destructive disabled={!clip.video} onSelect={onRemoveVideo}>
              <Trash2 /> Retirer la vidéo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex gap-5 p-5">
        <ClipVideoSlot clip={clip} busy={busy} onImport={onImport} onDropFile={onDropFile} />

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {content ? (
            <>
              <div>
                <p className="text-[13.5px] leading-relaxed" data-selectable>
                  {content.sceneDescription}
                </p>
                <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <MapPin className="size-3.5" /> {content.location}
                </p>
              </div>
              {content.dialogue.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface/70 p-3">
                  {content.dialogue.map((d, i) => (
                    <div key={i} className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 text-[13px]" data-selectable>
                      <span className="truncate font-semibold">{d.character}</span>
                      <span>
                        « {d.line} »{d.delivery && <span className="text-muted-foreground"> — {d.delivery}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">Contenu du clip illisible : régénérez-le.</p>
          )}

          <Tabs defaultValue="prompt" className="flex flex-col gap-3">
            <TabsList className="self-start">
              <TabsTrigger value="prompt">
                <Sparkles /> Prompt Flow
              </TabsTrigger>
              <TabsTrigger value="direction" disabled={!content}>
                <Camera /> Caméra & jeu
              </TabsTrigger>
              <TabsTrigger value="audio" disabled={!content}>
                <Volume2 /> Son
              </TabsTrigger>
              <TabsTrigger value="continuity" disabled={!content}>
                <Waypoints /> Continuité
              </TabsTrigger>
            </TabsList>

            <TabsContent value="prompt" className="flex flex-col gap-2">
              {editing ? (
                <>
                  <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-64 font-mono text-[12px] leading-relaxed" autoFocus />
                  <div className="flex items-center justify-end gap-2">
                    <span className="mr-auto text-[11.5px] text-muted-foreground">≈ {estimateTokens(draft)} tokens</span>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                      Annuler
                    </Button>
                    <Button
                      size="sm"
                      loading={saving}
                      disabled={!draft.trim()}
                      onClick={async () => {
                        setSaving(true);
                        try {
                          await onSavePrompt(draft);
                          setEditing(false);
                        } catch {
                          // erreur deja notifiee ; le brouillon reste ouvert
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      Enregistrer le prompt
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="group relative">
                    <pre className="max-h-56 overflow-y-auto rounded-lg border border-border bg-surface-strong px-3.5 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/90" data-selectable>
                      {clip.flowPrompt}
                    </pre>
                    <Tooltip content="Modifier le prompt">
                      <Button variant="secondary" size="icon-xs" className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100" onClick={() => { setDraft(clip.flowPrompt); setEditing(true); }} aria-label="Modifier le prompt">
                        <Pencil />
                      </Button>
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
                    <span>≈ {tokens} tokens</span>
                    {clip.promptEdited && <Badge variant="outline">Modifié à la main</Badge>}
                    {tokens > 1000 && <span className="text-warning">Prompt long : Flow peut le tronquer.</span>}
                  </div>
                </>
              )}
            </TabsContent>

            {content && (
              <>
                <TabsContent value="direction" className="flex flex-col gap-4">
                  <InfoRow icon={Camera} label="Caméra">
                    {content.cameraDirections}
                  </InfoRow>
                  <InfoRow icon={MessageSquareQuote} label="Actions">
                    <Beats items={content.characterActions} />
                  </InfoRow>
                  <InfoRow icon={Sparkles} label="Expressions">
                    <Beats items={content.facialExpressions} />
                  </InfoRow>
                </TabsContent>
                <TabsContent value="audio" className="flex flex-col gap-4">
                  <InfoRow icon={Volume2} label="Effets sonores">
                    {content.soundEffects.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {content.soundEffects.map((s, i) => (
                          <Badge key={i} variant="default" className="max-w-full whitespace-normal">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      "—"
                    )}
                  </InfoRow>
                  <InfoRow icon={Music2} label="Musique">
                    {content.musicInstructions}
                  </InfoRow>
                </TabsContent>
                <TabsContent value="continuity">
                  <InfoRow icon={Waypoints} label="Continuité avec les clips voisins">
                    {content.continuityInstructions}
                  </InfoRow>
                </TabsContent>
              </>
            )}
          </Tabs>
        </div>
      </div>
    </Card>
  );
}
