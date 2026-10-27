import { expect, spyOn, test } from "bun:test";

import { toast } from "~/components/ui/toast";
import {
  rememberImportFailure,
  showImportFailure,
} from "~/lib/import-recovery";

test("a module failure before the toast provider mounts is reported later", () => {
  const add = spyOn(toast, "add").mockReturnValue("chunk-load-error");

  try {
    showImportFailure();
    expect(add).not.toHaveBeenCalled();

    rememberImportFailure();
    expect(add).not.toHaveBeenCalled();

    showImportFailure();
    expect(add).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "chunk-load-error", timeout: 0 })
    );
  } finally {
    add.mockRestore();
  }
});
