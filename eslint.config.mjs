import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/target/**", "**/src-tauri/gen/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { URL: "readonly", console: "readonly", process: "readonly" } }
  },
  {
    files: ["packages/fastclaw-adapter/src/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "Literal[value=/^\\/api\\//]",
        message: "fastclaw-adapter may only call FastClaw /v1/* (no /api/*)."
      }]
    }
  }
);
