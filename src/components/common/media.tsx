import { useState, type ReactNode } from "react";
import { Apple, Banana, Cherry, Citrus, Grape, ImageOff, Play } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fileUrl } from "@/services/storage/media";
import { cn } from "@/utils/cn";
import { initials } from "@/utils/format";

/** Icone de fruit deduite de l'espece (pour les avatars sans image). */
export function fruitIcon(species: string): LucideIcon {
  const s = species.toLowerCase();
  if (/banan/.test(s)) return Banana;
  if (/cerise|cherry|fraise|framboise/.test(s)) return Cherry;
  if (/citron|orange|pamplemousse|mandarine|lime|agrume|clementine|clémentine/.test(s)) return Citrus;
  if (/raisin|grape|myrtille|mûre|mure/.test(s)) return Grape;
  return Apple;
}

/** Image locale avec repli elegant si le fichier est absent. */
export function LocalImage({
  path,
  alt,
  className,
  fallback,
  fit = "cover",
}: {
  path: string | null | undefined;
  alt: string;
  className?: string;
  fallback?: ReactNode;
  fit?: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);
  const src = fileUrl(path);
  if (!src || failed) {
    return (
      <div className={cn("flex items-center justify-center bg-surface text-muted-foreground", className)}>
        {fallback ?? <ImageOff className="size-5" strokeWidth={1.5} />}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn(fit === "cover" ? "object-cover" : "object-contain", className)}
    />
  );
}

export function CharacterAvatar({
  name,
  species,
  color,
  coverPath,
  size = 36,
  className,
  ring = false,
}: {
  name: string;
  species: string;
  color: string;
  coverPath: string | null | undefined;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const Icon = fruitIcon(species);
  const fallback = (
    <div
      className="flex size-full items-center justify-center"
      style={{ backgroundColor: `${color}22`, color }}
      title={name}
    >
      {size >= 44 ? <Icon className="size-1/2" strokeWidth={1.6} /> : <span className="text-[11px] font-semibold">{initials(name)}</span>}
    </div>
  );
  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded-full bg-surface", ring && "ring-2 ring-card", className)}
      style={{ width: size, height: size }}
      title={name}
    >
      <LocalImage path={coverPath} alt={name} className="size-full" fallback={fallback} />
    </div>
  );
}

export function AvatarStack({
  characters,
  max = 4,
  size = 26,
}: {
  characters: { id: string; name: string; species: string; color: string; coverPath: string | null }[];
  max?: number;
  size?: number;
}) {
  const shown = characters.slice(0, max);
  const rest = characters.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((c, i) => (
        <CharacterAvatar
          key={c.id}
          name={c.name}
          species={c.species}
          color={c.color}
          coverPath={c.coverPath}
          size={size}
          ring
          className={i > 0 ? "-ml-2" : undefined}
        />
      ))}
      {rest > 0 && (
        <div
          className="-ml-2 flex items-center justify-center rounded-full bg-secondary text-[10.5px] font-medium text-muted-foreground ring-2 ring-card"
          style={{ width: size, height: size }}
        >
          +{rest}
        </div>
      )}
    </div>
  );
}

/** Lecteur video local (protocole asset). */
export function LocalVideo({
  path,
  className,
  autoPlay = false,
  controls = true,
  poster,
}: {
  path: string;
  className?: string;
  autoPlay?: boolean;
  controls?: boolean;
  poster?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const src = fileUrl(path);
  if (!src || failed) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 bg-black/80 text-center text-xs text-white/70", className)}>
        <Play className="size-6" />
        Lecture impossible dans l'aperçu (format ou fichier manquant).
      </div>
    );
  }
  return (
    <video
      key={src}
      src={src}
      poster={fileUrl(poster) ?? undefined}
      controls={controls}
      autoPlay={autoPlay}
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
      className={cn("bg-black", className)}
    />
  );
}
