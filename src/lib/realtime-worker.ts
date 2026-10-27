import { createRealtimeHub } from "./realtime-shared";

const hub = createRealtimeHub();

globalThis.addEventListener("connect", (event) => {
  if (event instanceof MessageEvent) {
    for (const port of event.ports) {
      hub.attach(port);
    }
  }
});
