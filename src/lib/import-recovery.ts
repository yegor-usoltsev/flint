import { toast } from "~/components/ui/toast";

let failed = false;

export const rememberImportFailure = () => {
  failed = true;
};

export const showImportFailure = () => {
  if (!failed) {
    return;
  }

  toast.add({
    actionProps: {
      children: "Reload",
      onClick: () => {
        window.location.reload();
      },
    },
    description: "Check your connection, then reload when ready.",
    id: "chunk-load-error",
    timeout: 0,
    title: "Part of Flint could not load",
    type: "error",
  });
};
