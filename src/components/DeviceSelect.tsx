import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  devices: string[];
  selected: string[];
  onToggle: (device: string, on: boolean) => void;
  disabled?: boolean;
};

/** "Mikrofon (Steam Streaming Microphone)" → "Steam Streaming Microphone" */
export function shortDeviceName(name: string): string {
  const m = /^[^(]*\((.*)\)\s*$/.exec(name);
  return m ? m[1] : name;
}

/**
 * Multi-select over the microphones ffmpeg reported, so several can be recorded
 * at once. System sound is not in here — it is its own switch.
 */
export default function DeviceSelect({ devices, selected, onToggle, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const empty = devices.length === 0;
  const label = empty
    ? "No microphone"
    : selected.length === 0
      ? "None selected"
      : selected.length === 1
        ? shortDeviceName(selected[0])
        : `${selected.length} devices`;

  return (
    <div ref={root} className="relative ml-auto min-w-0">
      <button
        type="button"
        disabled={disabled || empty}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-7 max-w-[210px] items-center gap-1.5 rounded-lg border border-input bg-input/30 pr-1.5 pl-2.5 text-xs transition-colors outline-none hover:bg-input/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
          empty && "border-dashed text-muted-foreground",
          open && "border-ring",
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          data-popup
          className="absolute right-0 z-50 mt-1 w-[268px] rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10"
        >
          {devices.map((d) => {
            const on = selected.includes(d);
            return (
              <button
                key={d}
                type="button"
                title={d}
                onClick={() => onToggle(d, !on)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs outline-none hover:bg-accent",
                  on && "bg-secondary",
                )}
              >
                <span className="truncate">{d}</span>
                {on && <CheckIcon className="ml-auto size-3.5 shrink-0" />}
              </button>
            );
          })}
          <div className="my-1 h-px bg-border" />
          <p className="px-2 pb-1 text-[10.5px] leading-snug text-muted-foreground">
            Pick as many as you like. System sound is recorded separately.
          </p>
        </div>
      )}
    </div>
  );
}
