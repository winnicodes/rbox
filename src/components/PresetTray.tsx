import { useEffect, useRef, useState } from "react";
import {
  BookmarkIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EllipsisIcon,
  PencilIcon,
  PlusIcon,
  CropIcon,
  Trash2Icon,
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import type { Preset } from "@/lib/settings";
import { cn } from "@/lib/utils";

type Props = {
  presets: Preset[];
  active: string | null;
  summary: (p: Preset) => string;
  disabled?: boolean;
  onSelect: (name: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (name: string) => void;
  /** Start or stop remembering the current area in this preset. */
  onToggleArea: (name: string) => void;
};

/**
 * The active preset, shown read-only where it cannot be changed — the tray
 * pill minus the chevron. Switching presets is the main view's job.
 */
export function PresetBanner({ active }: { active: string | null }) {
  return (
    <div className="flex h-7 max-w-42.5 min-w-0 items-center gap-1.5 rounded-lg border border-border px-2 text-xs text-muted-foreground">
      <BookmarkIcon className="size-3.5 shrink-0" />
      <span className="truncate">{active ?? "No preset"}</span>
    </div>
  );
}

/**
 * The preset control plus its tray: a pill in the window title row, with the
 * tray as a popup underneath listing every preset and the values it records.
 * Changing a setting writes straight into the selected preset, so nothing here
 * saves.
 */
export default function PresetTray({
  presets,
  active,
  summary,
  disabled,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onToggleArea,
}: Props) {
  const [open, setOpen] = useState(false);
  /** Non-null while the name for a new preset is being typed. */
  const [naming, setNaming] = useState<string | null>(null);
  /** The row being renamed in place, with its draft text. */
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null);
  /** The row whose "…" menu is open. */
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const root = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    setMenuFor(null);
    setRenaming(null);
  }

  function commitRename() {
    if (renaming) onRename(renaming.name, renaming.value);
    setRenaming(null);
  }

  function onRenameKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") setRenaming(null);
    else return;
    // Escape would otherwise reach the document handler and close the tray.
    e.stopPropagation();
    e.preventDefault();
  }

  function onNamingKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      onCreate(naming ?? "");
      setNaming(null);
    } else if (e.key === "Escape") setNaming(null);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      // Escape peels one layer at a time: row menu first, then the tray.
      if (e.key !== "Escape") return;
      if (menuFor !== null) setMenuFor(null);
      else close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, menuFor]);

  /** The tray body — identical in both forms. */
  const rows = (
    <>
      {presets.map((p) => {
        const on = p.name === active;
        const draft = renaming && renaming.name === p.name ? renaming : null;
        const menuOpen = menuFor === p.name;
        return (
          <div
            key={p.name}
            className={cn(
              "flex h-14.5 items-center gap-3 rounded-[10px] px-3 transition-colors",
              on ? "bg-foreground/8" : "hover:bg-foreground/5",
            )}
          >
            <CheckIcon className={cn("size-4.5 shrink-0", on ? "opacity-100" : "opacity-0")} />
            {draft ? (
              <input
                autoFocus
                value={draft.value}
                spellCheck={false}
                onChange={(e) => setRenaming({ ...draft, value: e.currentTarget.value })}
                onKeyDown={onRenameKey}
                onBlur={commitRename}
                className="min-w-0 flex-1 bg-transparent text-[15px] font-medium outline-none"
              />
            ) : (
              <button
                type="button"
                title={p.name}
                onClick={() => {
                  close();
                  onSelect(on ? null : p.name);
                }}
                className="flex min-w-0 flex-1 flex-col gap-0.5 text-left outline-none"
              >
                <span className="truncate text-[15px] font-medium">{p.name}</span>
                <span className="truncate text-[13px] text-muted-foreground">{summary(p)}</span>
              </button>
            )}

            <div className="relative size-11 shrink-0">
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label={`Actions for ${p.name}`}
                aria-expanded={menuOpen}
                className="size-11 rounded-[10px] text-muted-foreground"
                onClick={() => setMenuFor(menuOpen ? null : p.name)}
              >
                <EllipsisIcon className="size-4.5" />
              </Button>
              {menuOpen && (
                <div
                  data-popup
                  className="absolute top-full right-0 z-50 mt-1 w-44 rounded-[10px] bg-popover p-1 shadow-md ring-1 ring-foreground/10"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setMenuFor(null);
                      setRenaming({ name: p.name, value: p.name });
                    }}
                    className="flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm outline-none hover:bg-accent"
                  >
                    <PencilIcon className="size-4 shrink-0" />
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuFor(null);
                      onToggleArea(p.name);
                    }}
                    className="flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm outline-none hover:bg-accent"
                  >
                    <CropIcon className="size-4 shrink-0" />
                    {p.area ? "Forget area" : "Remember area"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuFor(null);
                      onDelete(p.name);
                    }}
                    className="flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-destructive outline-none hover:bg-destructive/15"
                  >
                    <Trash2Icon className="size-4 shrink-0" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {presets.length > 0 && <div className="mx-3 my-1.5 h-px bg-border" />}

      <button
        type="button"
        onClick={() => {
          close();
          setNaming("");
        }}
        className="flex h-13 items-center gap-3 rounded-[10px] px-3 text-left text-[15px] font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground"
      >
        <PlusIcon className="size-4.5 shrink-0" />
        Save current settings as preset
      </button>
    </>
  );

  return (
    <div
      ref={root}
      className={cn("relative min-w-0", disabled && "pointer-events-none opacity-50")}
    >
      {naming !== null ? (
        <input
          autoFocus
          value={naming}
          placeholder="Preset name"
          spellCheck={false}
          onChange={(e) => setNaming(e.currentTarget.value)}
          onBlur={() => setNaming(null)}
          onKeyDown={onNamingKey}
          className="h-7 w-42.5 rounded-lg border border-ring bg-transparent px-2 text-xs outline-none"
        />
      ) : (
        <button
          type="button"
          aria-label="Presets"
          aria-expanded={open}
          onClick={() => (open ? close() : setOpen(true))}
          className={cn(
            "flex h-7 max-w-42.5 items-center gap-1.5 rounded-lg border pr-1.5 pl-2 text-xs transition-colors outline-none hover:bg-foreground/6 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            open ? "border-ring text-foreground" : "border-border text-muted-foreground",
          )}
        >
          <BookmarkIcon className="size-3.5 shrink-0" />
          <span className="truncate">{active ?? "No preset"}</span>
          {open ? (
            <ChevronUpIcon className="size-3.5 shrink-0" />
          ) : (
            <ChevronDownIcon className="size-3.5 shrink-0" />
          )}
        </button>
      )}

      {open && (
        <div
          data-popup
          className="absolute top-full left-0 z-50 mt-1.5 flex w-75 flex-col gap-0.5 rounded-[14px] bg-card p-2 shadow-[0_12px_30px_-12px_rgba(0,0,0,.8)]"
        >
          {rows}
        </div>
      )}
    </div>
  );
}
