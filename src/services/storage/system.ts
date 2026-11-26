import type { AppInfo, AppSettings, DashboardStats, KeyStatus } from "@/types";
import { call } from "./invoke";

export const settingsApi = {
  get: () => call<AppSettings>("settings_get"),
  update: (settings: AppSettings) => call<AppSettings>("settings_update", { settings }),
};

export const secretsApi = {
  status: () => call<KeyStatus>("gemini_key_status"),
  set: (key: string) => call<KeyStatus>("gemini_key_set", { key }),
  clear: () => call<KeyStatus>("gemini_key_clear"),
};

export const systemApi = {
  appInfo: () => call<AppInfo>("app_info"),
  stats: () => call<DashboardStats>("dashboard_stats"),
  reveal: (path: string) => call<void>("reveal_path", { path }),
  open: (path: string) => call<void>("open_path", { path }),
  exportTextFile: (path: string, contents: string) => call<void>("export_text_file", { path, contents }),
};
