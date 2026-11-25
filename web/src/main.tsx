import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import { installDiagnostics } from "./lib/diag";
import { SheetProvider } from "./lib/sheet";

installDiagnostics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      <SheetProvider>
        <App />
      </SheetProvider>
    </AuthGate>
  </StrictMode>,
);
