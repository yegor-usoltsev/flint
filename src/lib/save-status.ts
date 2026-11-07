export interface SaveTrack<Run> {
  failed: Run | null;
  pending: number;
  saved: boolean;
}

export type SaveEvent<Run> =
  | { type: "expire" }
  | { type: "fail"; run: Run }
  | { type: "reject" }
  | { type: "start" }
  | { type: "succeed" };

export const savedForMs = 2000;

export const idleSave = { failed: null, pending: 0, saved: false };

export const trackSave = <Run>(
  state: SaveTrack<Run>,
  event: SaveEvent<Run>
): SaveTrack<Run> => {
  switch (event.type) {
    case "start": {
      return { failed: null, pending: state.pending + 1, saved: false };
    }

    case "succeed": {
      const pending = Math.max(0, state.pending - 1);

      return {
        failed: state.failed,
        pending,
        saved: pending === 0 && state.failed === null,
      };
    }

    case "fail": {
      return {
        failed: event.run,
        pending: Math.max(0, state.pending - 1),
        saved: false,
      };
    }

    case "reject": {
      return { ...state, pending: Math.max(0, state.pending - 1) };
    }

    case "expire": {
      return { ...state, saved: false };
    }

    default: {
      return state;
    }
  }
};

export const saveStatus = <Run>(state: SaveTrack<Run>) => {
  if (state.pending > 0) {
    return "saving";
  }

  if (state.failed !== null) {
    return "failed";
  }

  return state.saved ? "saved" : "idle";
};
