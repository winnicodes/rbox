import { useEffect, useState } from "react";

type Props = {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
};

/**
 * Keeps its own text state so a half-typed value ("-", "") is not parsed and
 * pushed back into the rect, but still follows the value while dragging.
 */
export default function NumberField({ label, value, onChange, step = 1 }: Props) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);

  function commit(raw: string) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) onChange(n);
  }

  return (
    <label className="flex h-10 items-center gap-2 rounded-[10px] bg-white/6 px-3 text-sm text-zinc-400">
      <span className="w-3 font-semibold uppercase">{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setText(e.currentTarget.value);
          commit(e.currentTarget.value);
        }}
        onBlur={(e) => {
          setEditing(false);
          commit(e.currentTarget.value);
          setText(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          // Arrow keys belong to this input, not to the global nudge handler.
          e.stopPropagation();
        }}
        className="w-14 bg-transparent text-[15px] tabular-nums text-zinc-50 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
    </label>
  );
}
