import hooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
export default [
  { ignores: ["node_modules/**", ".next/**", "public/**", ".scratch/**"] },
  {
    files: ["**/*.{ts,tsx,mjs}"],
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": hooks },
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } } },
    rules: { "no-debugger": "error", "no-duplicate-case": "error", "no-unreachable": "error", "no-constant-condition": ["error", { checkLoops: false }], "constructor-super": "error", "valid-typeof": "error" },
  },
];
