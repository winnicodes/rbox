import { cn } from "@/lib/utils";

type Option<T> = { value: T; label: string };

type Props<T extends string | number> = {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  /** tabular mono digits — for FPS and similar numeric scales */
  mono?: boolean;
};

export default function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  mono,
}: Props<T>) {
  return (
    <div
      data-disabled={disabled || undefined}
      className="flex gap-1 rounded-[10px] bg-foreground/6 p-1 data-disabled:pointer-events-none data-disabled:opacity-50"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 rounded-lg px-3.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            mono && "font-mono tabular-nums",
            o.value === value
              ? "bg-foreground font-semibold text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
