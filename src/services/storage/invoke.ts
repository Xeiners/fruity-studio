/**
 * Appel type des commandes Rust avec normalisation des erreurs.
 * Les erreurs Rust arrivent sous la forme `{ kind, message }`.
 */
import { invoke } from "@tauri-apps/api/core";

export type AppErrorKind =
  | "db"
  | "io"
  | "not_found"
  | "validation"
  | "ffmpeg"
  | "secret"
  | "network"
  | "cancelled"
  | "other";

export class AppError extends Error {
  readonly kind: AppErrorKind;

  constructor(kind: AppErrorKind, message: string) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error && typeof error === "object" && "kind" in error && "message" in error) {
    const e = error as { kind: AppErrorKind; message: string };
    return new AppError(e.kind, e.message);
  }
  if (typeof error === "string") return new AppError("other", error);
  if (error instanceof Error) return new AppError("other", error.message);
  return new AppError("other", "Erreur inattendue.");
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new AppError("other", "Fruity Studio doit être lancé dans l'application de bureau (Tauri).");
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toAppError(error);
  }
}

/** Message lisible pour n'importe quelle erreur. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}
