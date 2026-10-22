import { PRO_INTERFACE_VERSION } from "@opengrok/shared-types";

// Placeholder shell. The UI talks to the local app service, never to FastClaw's web/ console.
export function App() {
  return (
    <main style={{ fontFamily: "Inter, sans-serif", padding: 24 }}>
      <h1>OpenGrok (codename)</h1>
      <p>说一句，剩下的交给它。Say it once. It handles the rest.</p>
      <small>shared interface v{PRO_INTERFACE_VERSION}</small>
    </main>
  );
}
