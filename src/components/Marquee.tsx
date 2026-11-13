import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * One line of text that, when it does not fit, scrolls to its end, jumps back
 * and repeats (see `.marquee` in index.css). Text that fits stays still.
 */
export default function Marquee({ children, className }: { children: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setOverflow(Math.max(0, el.scrollWidth - el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  return (
    <span ref={box} className={cn("block min-w-0 overflow-hidden whitespace-nowrap", className)}>
      <span
        className={overflow ? "marquee inline-block" : undefined}
        // ~30 px/s for the travel, plus the pauses at both ends.
        style={
          overflow
            ? ({ "--shift": `-${overflow}px`, animationDuration: `${3 + overflow / 30}s` } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </span>
    </span>
  );
}
