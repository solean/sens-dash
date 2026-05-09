import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";

import App from "./App";
import "./App.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const root = ReactDOM.createRoot(document.getElementById("root")!);

if (convexUrl) {
  const convex = new ConvexReactClient(convexUrl);

  root.render(
    <React.StrictMode>
      <ConvexProvider client={convex}>
        <App convexConfigured />
      </ConvexProvider>
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <App convexConfigured={false} />
    </React.StrictMode>,
  );
}
