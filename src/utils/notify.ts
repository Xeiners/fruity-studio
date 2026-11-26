import { toast } from "sonner";
import { GeminiError } from "@/services/gemini/errors";
import { errorMessage } from "@/services/storage/invoke";

/** Notification d'erreur homogene (titre + detail). */
export function notifyError(error: unknown, title = "Une erreur est survenue") {
  if (error instanceof GeminiError) {
    toast.error(error.title, { description: error.message, duration: 9000 });
    return;
  }
  toast.error(title, { description: errorMessage(error), duration: 7000 });
}

export function notifySuccess(title: string, description?: string) {
  toast.success(title, { description });
}
