"use client";

import { type ReactNode, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * An action that runs only after an explicit confirm. `details` shows exactly what will happen
 * (inputs, maximum price). The confirm fires once per opening: a double click never runs it twice.
 * It opens the dialog itself (no Trigger), so it works with every shadcn style, Radix or Base UI.
 */
export function ConfirmAction({
  label,
  title,
  description,
  details,
  confirmLabel = label,
  variant = "default",
  disabled,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  details?: ReactNode;
  confirmLabel?: string;
  variant?: "default" | "destructive" | "outline";
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const fired = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={button}
        variant={variant}
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => {
          fired.current = false;
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next: boolean) => {
          setOpen(next);
          // Back to the button that opened it, for keyboard users.
          if (!next) requestAnimationFrame(() => button.current?.focus());
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {details}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={variant === "outline" ? "default" : variant}
              onClick={() => {
                if (fired.current) return;
                fired.current = true;
                void onConfirm();
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
