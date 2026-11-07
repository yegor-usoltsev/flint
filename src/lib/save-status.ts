type Retry = () => void;

export interface SaveTrack {
  failed: Partial<Record<string, Retry>>;
  pending: number;
  saved: boolean;
}

export type SaveEvent =
  | { type: "expire" }
  | { key: string; retry: Retry; type: "fail" }
  | { key: string; type: "reject" | "start" | "succeed" };

export const savedForMs = 2000;

export const idleSave: SaveTrack = { failed: {}, pending: 0, saved: false };

const without = (failed: SaveTrack["failed"], key: string) =>
  Object.fromEntries(Object.entries(failed).filter(([name]) => name !== key));

export const trackSave = (state: SaveTrack, event: SaveEvent): SaveTrack => {
  if (event.type === "expire") {
    return { ...state, saved: false };
  }

  if (event.type === "start") {
    return {
      failed: without(state.failed, event.key),
      pending: state.pending + 1,
      saved: false,
    };
  }

  const pending = Math.max(0, state.pending - 1);

  if (event.type === "fail") {
    return {
      failed: { ...state.failed, [event.key]: event.retry },
      pending,
      saved: false,
    };
  }

  const failed = without(state.failed, event.key);

  return {
    failed,
    pending,
    saved:
      event.type === "succeed" &&
      pending === 0 &&
      Object.keys(failed).length === 0,
  };
};

export const saveStatus = (state: SaveTrack) => {
  if (state.pending > 0) {
    return "saving";
  }

  if (Object.keys(state.failed).length > 0) {
    return "failed";
  }

  return state.saved ? "saved" : "idle";
};
