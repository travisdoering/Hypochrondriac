"use client";

import type { Attachment } from "./store";

/** Minimal event bus so side panels can drop a message into the conversation. */
export interface SendRequest {
  text: string;
  attachments?: Attachment[];
  extra?: string;
}

type Handler = (req: SendRequest) => void;
const handlers = new Set<Handler>();

export const bus = {
  onSend(h: Handler) {
    handlers.add(h);
    return () => {
      handlers.delete(h);
    };
  },
  send(req: SendRequest) {
    handlers.forEach((h) => h(req));
  },
};
