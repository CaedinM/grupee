import { ClerkProvider } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import "./index.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) {
  throw new Error("Set VITE_CLERK_PUBLISHABLE_KEY in admin/.env (see frontend/.env)");
}

// Same palette as the phone app; applied here so every Clerk component
// (sign-in card, verification step) matches without per-component styling.
const appearance = {
  baseTheme: dark,
  variables: {
    colorPrimary: "#5b5bf0",
    colorBackground: "#1c1c22",
    colorInputBackground: "#101014",
    colorText: "#ffffff",
    colorTextSecondary: "#9a9aa5",
    colorDanger: "#ff6b6b",
    borderRadius: "12px",
    fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
  },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={publishableKey} appearance={appearance}>
      <App />
    </ClerkProvider>
  </StrictMode>
);
