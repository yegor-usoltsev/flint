import { useId, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";

export const ConfirmDelete = ({
  action,
  confirmText,
  description,
  onConfirm,
  pending,
  title,
}: {
  action: string;
  confirmText: string;
  description: string;
  onConfirm: () => void;
  pending: boolean;
  title: string;
}) => {
  const [typed, setTyped] = useState("");
  const id = useId();

  return (
    <AlertDialog
      onOpenChange={() => {
        setTyped("");
      }}
    >
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        {action}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor={id}>
            Type <strong className="font-mono">{confirmText}</strong> to confirm
          </FieldLabel>
          <Input
            autoCapitalize="none"
            autoComplete="off"
            id={id}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            spellCheck={false}
            value={typed}
          />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || typed.trim() !== confirmText}
            onClick={onConfirm}
            variant="destructive"
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
