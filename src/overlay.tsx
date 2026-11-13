import React from "react";
import ReactDOM from "react-dom/client";
import Overlay from "@/components/Overlay";
import { blockBrowserKeys } from "@/lib/appKeys";
import { loadLanguage } from "@/lib/i18n";
import { loadSettings } from "@/lib/settings";
import "./index.css";

blockBrowserKeys();

await loadLanguage(loadSettings().language);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>,
);
