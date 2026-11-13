import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { hideTipWindow, showTipWindow } from "@/lib/tipWindow";

/**
 * Hover label in the app's own style, used instead of `title` everywhere. Put
 * it inside an element with `relative`. It sits above, flips below when the
 * window's top edge is in the way and slides in from the sides. When it fits
 * neither way (the one-row compact bar) it shows in a window of its own, so
 * the UI never grows for it.
 */
export default function Tip({ children }: { children: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ below: boolean; dx: number; away: number } | null>(null);

  useEffect(() => {
    const el = anchor.current?.parentElement;
    if (!el) return;
    const on = () => setShow(true);
    const off = () => {
      setShow(false);
      setPos(null);
    };
    // Keyboard focus only; a click focuses too and should not leave a label.
    const focus = () => el.matches(":focus-visible") && on();
    const events = [
      ["pointerenter", on],
      ["pointerleave", off],
      ["pointerdown", off],
      ["focusin", focus],
      ["focusout", off],
    ] as const;
    for (const [e, f] of events) el.addEventListener(e, f);
    return () => {
      for (const [e, f] of events) el.removeEventListener(e, f);
    };
  }, []);

  // Measured once per showing, before paint, from the default spot above.
  useLayoutEffect(() => {
    if (!show || pos || !tip.current) return;
    const r = tip.current.getBoundingClientRect();
    const host = anchor.current!.parentElement!.getBoundingClientRect();
    const edge = 4;
    const below = r.top < edge;
    // Fits neither above nor below: the tip window's id, else 0.
    const away =
      below && host.bottom + 6 + r.height > innerHeight - edge ? showTipWindow(children, host) : 0;
    setPos({ below, away, dx: Math.max(edge - r.left, Math.min(0, innerWidth - edge - r.right)) });
  }, [show, pos, children]);

  const away = pos?.away;
  useEffect(() => {
    if (away) return () => hideTipWindow(away);
  }, [away]);

  return (
    <span ref={anchor} className="contents">
      {/* Gone, not hidden, once it lives in the tip window: flipped below a
          one-row window it would overflow it and flash a scrollbar. */}
      {show && !pos?.away && (
        <span
          ref={tip}
          style={{
            translate: `calc(-50% + ${pos?.dx ?? 0}px)`,
            visibility: pos ? "visible" : "hidden",
          }}
          className={cn(
            "pointer-events-none absolute left-1/2 z-50 w-max max-w-72 rounded-md bg-popover px-2 py-1 text-left text-xs font-normal text-foreground shadow-md ring-1 ring-foreground/10",
            pos?.below ? "top-full mt-1.5" : "bottom-full mb-1.5",
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
