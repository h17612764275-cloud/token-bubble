import type { Language } from "../types";

export interface UpdateMessages {
  checking: string;
  current: string;
  downloading: (version: string) => string;
  installing: string;
  availableWindows: (version: string) => string;
  availableMac: (version: string) => string;
  failed: string;
}

export async function checkForAppUpdate(
  _language: Language,
  messages: UpdateMessages,
  setStatus: (message: string | null) => void,
  manual = false,
): Promise<void> {
  if (manual) setStatus(messages.current);
}
