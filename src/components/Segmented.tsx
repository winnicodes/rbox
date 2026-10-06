import { cn } from "@/lib/utils";

type Option<T> = { value: T; label: string };

type Props<T extends string | number> = {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  /** tabular mono digits — for FPS and similar numeric scales */
  mono?: boolean;
  /** Extra segment at the end of the track, e.g. a custom value. */
  children?: React.ReactNode;
};

/** Shared look for a segment, so a custom slot can match the buttons. */
export const SEGMENT =
  "flex flex-1 items-center justify-center gap-1 rounded-[7px] py-1.25 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
export const SEGMENT_ON = "bg-foreground font-semibold text-background";
export const SEGMENT_OFF = "text-muted-foreground hover:text-foreground";

export default function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  mono,
  children,
}: Props<T>) {
  return (
    <div
      data-disabled={disabled || undefined}
      className="flex gap-0.5 rounded-[9px] bg-muted p-0.75 whitespace-nowrap data-disabled:pointer-events-none data-disabled:opacity-50"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            SEGMENT,
            mono && "font-mono font-medium tabular-nums",
            o.value === value ? SEGMENT_ON : SEGMENT_OFF,
          )}
        >
          {o.label}
        </button>
      ))}
      {children}
    </div>
  );
}
