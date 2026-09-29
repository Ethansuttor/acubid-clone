import { matchLocalTile, prepareTemplates } from "./local";
import type { GrayImage } from "./ncc";

let templates: GrayImage[] = [];
self.onmessage = (event: MessageEvent<{ template?: GrayImage; image?: GrayImage; minScore?: number; scaleTolerance?: boolean }>) => {
  try {
    if (event.data.template) {
      templates = prepareTemplates(event.data.template, event.data.scaleTolerance);
      self.postMessage({ ready: true });
    } else if (event.data.image && templates.length) {
      self.postMessage({ detections: matchLocalTile(event.data.image, templates, event.data.minScore) });
    } else throw new Error("Detector has no example symbol.");
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Local detection failed." });
  }
};
