import { useNavigate } from "react-router";
import { Command } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Clapperboard, Moon, Plus, Search, Sun, UserPlus } from "lucide-react";
import { CharacterAvatar } from "@/components/common/media";
import { useCharacters, useProductions } from "@/hooks/queries";
import { useTheme } from "@/hooks/useTheme";
import { useSetTheme } from "@/hooks/useSetTheme";
import { NAV_ITEMS } from "./Sidebar";

const itemClass =
  "flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-[13px] text-foreground outline-none select-none data-[selected=true]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground";
const groupClass =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { data: characters } = useCharacters(false);
  const { data: productions } = useProductions();
  const { resolved } = useTheme();
  const setPreference = useSetTheme();

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed top-[16vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl shadow-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]">
          <DialogPrimitive.Title className="sr-only">Palette de commandes</DialogPrimitive.Title>
          <Command label="Palette de commandes" loop>
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search className="size-4 text-muted-foreground" />
              <Command.Input
                autoFocus
                placeholder="Rechercher une page, un personnage, une production…"
                className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/70"
              />
            </div>
            <Command.List className="max-h-[52vh] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted-foreground">Aucun résultat.</Command.Empty>
              <Command.Group heading="Actions" className={groupClass}>
                <Command.Item className={itemClass} onSelect={() => go("/productions/new")}>
                  <Plus /> Nouvelle production
                </Command.Item>
                <Command.Item className={itemClass} onSelect={() => go("/characters/new")}>
                  <UserPlus /> Nouveau personnage
                </Command.Item>
                <Command.Item
                  className={itemClass}
                  onSelect={() => {
                    setPreference(resolved === "dark" ? "light" : "dark");
                    onOpenChange(false);
                  }}
                >
                  {resolved === "dark" ? <Sun /> : <Moon />} Passer au thème {resolved === "dark" ? "clair" : "sombre"}
                </Command.Item>
              </Command.Group>
              <Command.Group heading="Navigation" className={groupClass}>
                {NAV_ITEMS.map((item) => (
                  <Command.Item key={item.to} className={itemClass} onSelect={() => go(item.to)}>
                    <item.icon /> {item.label}
                    <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{item.shortcut}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              {characters && characters.length > 0 && (
                <Command.Group heading="Personnages" className={groupClass}>
                  {characters.map((c) => (
                    <Command.Item key={c.id} value={`personnage ${c.name} ${c.species}`} className={itemClass} onSelect={() => go(`/characters/${c.id}`)}>
                      <CharacterAvatar name={c.name} species={c.species} color={c.color} coverPath={c.coverPath} size={22} />
                      {c.name}
                      <span className="text-muted-foreground">· {c.species}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {productions && productions.length > 0 && (
                <Command.Group heading="Productions" className={groupClass}>
                  {productions.map((p) => (
                    <Command.Item key={p.id} value={`production ${p.title}`} className={itemClass} onSelect={() => go(`/productions/${p.id}`)}>
                      <Clapperboard /> {p.title}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
