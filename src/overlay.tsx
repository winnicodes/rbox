import React from "react";
import ReactDOM from "react-dom/client";
import Overlay from "@/components/Overlay";
import { blockBrowserKeys } from "@/lib/appKeys";
import "./index.css";

blockBrowserKeys();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>,
);
