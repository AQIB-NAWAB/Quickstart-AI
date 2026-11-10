"use client";

import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

type LeadSelectOption<Value extends string> = {
  value: Value;
  label: string;
  icon?: LucideIcon;
};

/** Matches the marketing TemplatePicker's custom menu and keyboard interactions. */
export function LeadSelect<Value extends string>({
  label,
  value,
  options,
  onChange,
  icon: Icon,
  disabled = false,
}: {
  label: string;
  value: Value;
  options: readonly LeadSelectOption<Value>[];
  onChange: (value: Value) => void;
  icon?: LucideIcon;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const [opensUp, setOpensUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex];

  function openMenu() {
    const bounds = root.current?.getBoundingClientRect();
    if (bounds) {
      const below = window.innerHeight - bounds.bottom;
      setOpensUp(below < options.length * 48 + 21 && bounds.top > below);
    }
    setFocused(selectedIndex);
    setOpen(true);
  }

  function close(restore = false) {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }

  useEffect(() => {
    if (open) items.current[focused]?.focus();
  }, [open, focused]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  return (
    <div
      ref={root}
      className="lr-select"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) close();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="lr-select-trigger"
        disabled={disabled}
        aria-label={`${label}: ${selected?.label || "Select"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (open) close();
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        {Icon && <Icon aria-hidden="true" />}
        <span>
          {label}: <strong>{selected?.label || "Select"}</strong>
        </span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div
          id={id}
          role="listbox"
          aria-label={label}
          className={`lr-select-menu ${opensUp ? "lr-select-menu-up" : ""}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              setFocused(
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : (focused + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
                      options.length,
              );
            }
          }}
        >
          {options.map(({ value: nextValue, label: optionLabel, icon: OptionIcon }, index) => (
            <button
              key={nextValue}
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={value === nextValue}
              tabIndex={focused === index ? 0 : -1}
              onClick={() => {
                onChange(nextValue);
                close(true);
              }}
            >
              {OptionIcon && <OptionIcon aria-hidden="true" />}
              <span>{optionLabel}</span>
              {value === nextValue && <Check className="lr-select-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
