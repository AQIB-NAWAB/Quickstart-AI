"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface FeatureDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
  roundedClass?: string;
  backdropClass?: string;
  isSubmitting?: boolean;
  layout?: "default" | "lead-wizard" | "settings";
  bodyClassName?: string;
}

export function FeatureDialog({
  open,
  onClose,
  title,
  description,
  children,
  maxWidthClass = "max-w-[520px]",
  roundedClass = "rounded-16",
  backdropClass = "bg-accent-black/40 backdrop-blur-sm",
  isSubmitting = false,
  layout = "default",
  bodyClassName,
}: FeatureDialogProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const closeRef = useRef(onClose);
  const submittingRef = useRef(isSubmitting);
  closeRef.current = onClose;
  submittingRef.current = isSubmitting;

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const elements = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => (elements()[0] ?? dialogRef.current)?.focus());
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!submittingRef.current) closeRef.current();
      }
      if (event.key !== "Tab") return;
      const controls = elements();
      const first = controls[0],
        last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 !m-0 !mt-0 z-50 flex items-center justify-center p-4 transition-opacity duration-150 ${backdropClass}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`w-full ${maxWidthClass} console-feature ${layout === "lead-wizard" ? "lead-console lead-wizard-dialog" : layout === "settings" ? "settings-dialog" : ""} bg-white ${roundedClass} border border-border-faint shadow-sm flex flex-col max-h-[calc(100dvh-32px)] overflow-hidden focus:outline-none`}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border-faint flex items-center justify-between shrink-0">
          <div>
            <h2 id={titleId} className="text-base font-bold text-accent-black tracking-tight">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="text-xs text-neutral-500 mt-0.5">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 rounded-8 text-neutral-400 hover:text-accent-black hover:bg-neutral-100 transition-colors disabled:opacity-40"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div
          className={
            bodyClassName ??
            (layout !== "default"
              ? "lead-wizard-host flex min-h-0 flex-col"
              : "px-6 py-5 overflow-y-auto min-h-0")
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
