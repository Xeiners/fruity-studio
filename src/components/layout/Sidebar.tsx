import { NavLink, useNavigate } from "react-router";
import { Clapperboard, Images, LayoutDashboard, Moon, Plus, Search, Settings, Share2, Sun, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/display";
import { Tooltip } from "@/components/ui/menus";
import { useAppInfo, useFfmpeg, useKeyStatus } from "@/hooks/queries";
import { useTheme } from "@/hooks/useTheme";
import { useSetTheme } from "@/hooks/useSetTheme";
import { useFfmpegInstall } from "@/features/setup/ffmpegInstallStore";
import { openSetup } from "@/features/setup/setupStore";
import { cn } from "@/utils/cn";

export const NAV_ITEMS: { to: string; label: string; icon: LucideIcon; shortcut: string; end?: boolean }[] = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard, shortcut: "Ctrl 1", end: true },
  { to: "/characters", label: "Personnages", icon: UsersRound, shortcut: "Ctrl 2" },
  { to: "/productions", label: "Productions", icon: Clapperboard, shortcut: "Ctrl 3" },
  { to: "/library", label: "Médiathèque", icon: Images, shortcut: "Ctrl 4" },
  { to: "/networks", label: "Mes réseaux", icon: Share2, shortcut: "Ctrl 5" },
  { to: "/settings", label: "Paramètres", icon: Settings, shortcut: "Ctrl 6" },
];

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/logo.svg"
      alt=""
      width={size}
      height={size}
      draggable={false}
      className="shrink-0 rounded-[22%] bg-[#fefefe] object-contain ring-1 ring-black/10 dark:ring-white/10"
    />
  );
}

function StatusDot({ ok, label, busy, detail }: { ok: boolean | undefined; label: string; busy?: boolean; detail?: string }) {
  return (
    <Tooltip content={busy ? `${label} : installation en cours` : ok ? `${label} : prêt` : `${label} : à configurer — cliquez pour l'assistant`}>
      <button
        type="button"
        onClick={openSetup}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            busy ? "animate-pulse bg-primary" : ok === undefined ? "bg-muted-foreground/40" : ok ? "bg-success" : "bg-orange",
          )}
        />
        {label}
        {detail && <span className="font-mono text-[10.5px]">{detail}</span>}
      </button>
    </Tooltip>
  );
}

export function Sidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const navigate = useNavigate();
  const { data: info } = useAppInfo();
  const { data: key } = useKeyStatus();
  const { data: ffmpeg } = useFfmpeg();
  const install = useFfmpegInstall();
  const { resolved } = useTheme();
  const setPreference = useSetTheme();

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <BrandMark />
        <div className="leading-tight">
          <div className="text-[14px] font-semibold tracking-tight">Fruity Studio</div>
          <div className="text-[11px] text-muted-foreground">Studio de production</div>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3">
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex h-8 items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 text-[12.5px] text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Rechercher…</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <Button className="w-full justify-start gap-2 px-3" onClick={() => navigate("/productions/new")}>
          <Plus />
          <span className="flex-1 text-left">Nouvelle production</span>
          <Kbd className="h-[18px] border-primary-foreground/20 bg-primary-foreground/10 px-1 text-[10px] text-primary-foreground/70">Ctrl N</Kbd>
        </Button>
      </div>

      <nav className="mt-5 flex flex-col gap-0.5 px-3" aria-label="Navigation principale">
        <div className="px-2.5 pb-1.5 text-eyebrow">Studio</div>
        {NAV_ITEMS.slice(0, 5).map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 px-3 pb-4">
        <NavItem {...NAV_ITEMS[5]} />
        <div className="mt-1 flex items-center gap-1 border-t border-border px-1 pt-3">
          <StatusDot ok={key?.configured} label="Gemini" />
          <StatusDot
            ok={ffmpeg ? ffmpeg.found && !ffmpeg.error : undefined}
            label="FFmpeg"
            busy={install.running}
            detail={install.running && install.stage === "downloading" ? `${Math.round(install.percent)}%` : undefined}
          />
          <div className="ml-auto flex items-center">
            <Tooltip content={resolved === "dark" ? "Thème clair" : "Thème sombre"}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Changer de thème"
                onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}
              >
                {resolved === "dark" ? <Sun /> : <Moon />}
              </Button>
            </Tooltip>
            <Tooltip content="Paramètres" shortcut="Ctrl ,">
              <Button variant="ghost" size="icon-xs" aria-label="Paramètres" onClick={() => navigate("/settings")}>
                <Settings />
              </Button>
            </Tooltip>
          </div>
        </div>
        <div className="px-2 font-mono text-[10.5px] text-muted-foreground/70">Fruity Studio v{info?.version ?? "0.1.0"}</div>
      </div>
    </aside>
  );
}

function NavItem({ to, label, icon: Icon, end }: { to: string; label: string; icon: LucideIcon; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
          isActive
            ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.07)] dark:bg-accent dark:shadow-none"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute top-1.5 bottom-1.5 -left-3 w-[3px] rounded-r-full bg-primary" />}
          <Icon className={cn("size-4", isActive ? "text-primary-strong" : "text-muted-foreground group-hover:text-foreground")} />
          {label}
        </>
      )}
    </NavLink>
  );
}
