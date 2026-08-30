import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../web/src/App.js";
import { installDesktopFileBridge } from "./desktopFileBridge.js";
import "../../web/src/styles.css";

installDesktopFileBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
