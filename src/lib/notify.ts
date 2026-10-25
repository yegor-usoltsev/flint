import { toast } from "~/components/ui/toast";

export const notifyError = (title: string) => (error: Error) => {
  toast.add({ description: error.message, title, type: "error" });
};

export const notifyWithAction = ({
  action,
  description,
  onAction,
  title,
  type,
}: {
  action: string;
  description?: string;
  onAction: () => void;
  title: string;
  type?: "error";
}) => {
  const id = toast.add({
    actionProps: {
      children: action,
      onClick: () => {
        toast.close(id);
        onAction();
      },
    },
    description,
    title,
    type,
  });
};
