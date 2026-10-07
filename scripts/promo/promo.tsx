// The README promo images, laid out at 1920x1080 around the REAL app UI.
// Rendered by shoot.mjs; only the two native Windows menus are drawn here.
import React from "react";
import ReactDOM from "react-dom/client";
import {
  AppWindowIcon,
  ClipboardCopyIcon,
  FilmIcon,
  FolderOutputIcon,
  ImageIcon,
  PowerIcon,
  SaveIcon,
  SquareArrowOutUpRightIcon,
  VideoIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import App from "../../src/App";
import logo from "../../src/assets/logo.svg";
import { installMocks } from "./mock";
import "../../src/index.css";

installMocks("main");

const REPO = "github.com/winnicodes/rbox";
/** The app is sized for a 480 px window; the promo shows it a bit larger. */
const ZOOM = 1.22;

function Header({ title }: { title: string }) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3 text-[26px]">
        <img src={logo} alt="" className="size-9 rounded-lg" />
        <span className="font-semibold tracking-tight text-white">rbox</span>
        <span className="text-white/30">·</span>
        <span className="text-white/70">{title}</span>
      </div>
      <span className="font-mono text-[24px] text-red-400">{REPO}</span>
    </header>
  );
}

function Label({ children }: { children: string }) {
  return <div className="mb-3 text-[18px] text-white/55">{children}</div>;
}

/** A window of the real app. `width` is the window width the app expects. */
function Win({ width, id }: { width?: number; id: string }) {
  return (
    <div
      data-win={id}
      className="w-fit overflow-hidden rounded-[16px] ring-1 ring-white/10 shadow-[0_30px_60px_-20px_rgba(0,0,0,.8)]"
      style={{ zoom: ZOOM }}
    >
      <div style={{ width }}>
        <App />
      </div>
    </div>
  );
}

type Entry = [string, LucideIcon] | "sep";

/** Windows 11 dark context menu, as Tauri's native menus render. */
function NativeMenu({ entries, hover, zoom = 1.1 }: { entries: Entry[]; hover?: number; zoom?: number }) {
  return (
    <div
      className="w-fit rounded-[8px] border border-[#3d3d3d] bg-[#2c2c2c] p-1 shadow-[0_16px_40px_-8px_rgba(0,0,0,.7)]"
      style={{ fontFamily: "'Segoe UI Variable Text', 'Segoe UI', sans-serif", zoom }}
    >
      {entries.map((e, i) =>
        e === "sep" ? (
          <div key={i} className="mx-1 my-1 h-px bg-[#454545]" />
        ) : (
          <div
            key={i}
            className="flex h-8 min-w-44 items-center gap-3 rounded-[4px] pr-8 pl-3 text-[14px] text-white"
            style={{ background: i === hover ? "#383838" : undefined }}
          >
            {React.createElement(e[1], { className: "size-4 text-[#9a9a9a]" })}
            {e[0]}
          </div>
        ),
      )}
    </div>
  );
}

const TRAY: Entry[] = [
  ["Screenshot", ImageIcon],
  ["Video", VideoIcon],
  ["GIF", FilmIcon],
  "sep",
  ["Open rbox", AppWindowIcon],
  ["Quit rbox", PowerIcon],
];

const SHOT: Entry[] = [
  ["Copy to clipboard", ClipboardCopyIcon],
  ["Save", SaveIcon],
  ["Save to…", FolderOutputIcon],
  ["Save and open with…", SquareArrowOutUpRightIcon],
  "sep",
  ["Close", XIcon],
];

function Promo2() {
  return (
    <>
      <Header title="The whole app: one panel, one settings page, a tray icon" />
      <div className="mt-14 flex gap-11">
        <div className="flex flex-col">
          <Label>Main panel</Label>
          <Win id="panel" width={480} />
          <div className="mt-10">
            <Label>While recording: on top, never in the video</Label>
            <Win id="rec" />
          </div>
        </div>
        <div className="flex flex-col">
          <Label>Settings</Label>
          <Win id="settings" width={620} />
        </div>
        <div className="flex flex-col gap-10">
          <div>
            <Label>Tray menu</Label>
            <NativeMenu entries={TRAY} />
          </div>
          <div>
            <Label>After a screenshot</Label>
            <NativeMenu entries={SHOT} />
          </div>
        </div>
      </div>
    </>
  );
}

function Step({
  n,
  title,
  sub,
  width,
  children,
}: {
  n: number;
  title: string;
  sub: string;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col" style={{ width }}>
      <div className="flex h-[440px] items-center justify-center overflow-hidden rounded-[18px] bg-black/25 ring-1 ring-white/10">
        {children}
      </div>
      <div className="mt-7 flex items-baseline gap-4">
        <span className="font-mono text-[22px] text-red-400">0{n}</span>
        <span className="text-[30px] font-semibold tracking-tight text-white">{title}</span>
      </div>
      <p className="mt-2 text-[19px] leading-snug text-white/55">{sub}</p>
    </div>
  );
}

/** Crop of the overlay screenshot (1920x1080): the frame and its toolbar. */
function OverlayCrop() {
  const crop = { x: 560, y: 290, w: 1070, h: 540 };
  const s = 740 / crop.w;
  return (
    <div
      className="rounded-[10px]"
      style={{
        width: crop.w * s,
        height: crop.h * s,
        backgroundImage: "url(./.shots/overlay.png)",
        backgroundSize: `${1920 * s}px auto`,
        backgroundPosition: `${-crop.x * s}px ${-crop.y * s}px`,
      }}
    />
  );
}

function Promo3() {
  return (
    <>
      <Header title="A Snipping Tool replacement" />
      <h1 className="mt-16 text-[64px] leading-[1.05] font-bold tracking-tight text-white">
        Press Print. Drag. Pick.
      </h1>
      <div className="mt-14 flex gap-[50px]">
        <Step n={1} width={380} title="Press Print" sub="Or right-click the tray icon: Screenshot, Video or GIF.">
          <kbd className="flex h-[140px] w-[230px] items-center justify-center rounded-[20px] border border-white/15 bg-gradient-to-b from-[#2a2e37] to-[#1d2027] font-sans text-[42px] font-semibold text-white shadow-[0_10px_0_#0d0f13,0_30px_50px_-10px_rgba(0,0,0,.8)]">
            Print
          </kbd>
        </Step>
        <Step n={2} width={780} title="Drag a frame" sub="Screenshot is preselected. Switch to Video or GIF right on the toolbar.">
          <OverlayCrop />
        </Step>
        <Step n={3} width={440} title="Pick what happens" sub="Copy it, save it, or save and open it in your editor.">
          <NativeMenu entries={SHOT} hover={0} zoom={1.3} />
        </Step>
      </div>
    </>
  );
}

const page = new URLSearchParams(location.search).get("n");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <div
    className="h-[1080px] w-[1920px] overflow-hidden px-[110px] pt-[80px] font-sans"
    // Same slate gradient as rbox-promo-1.png.
    style={{ background: "linear-gradient(120deg, #2e3748 0%, #1f2532 45%, #0f1319 100%)" }}
  >
    {page === "3" ? <Promo3 /> : <Promo2 />}
  </div>,
);
