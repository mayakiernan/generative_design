// Markdown imported as text (bundle-api.mjs uses esbuild's text loader).
declare module '*.md' {
  const text: string;
  export default text;
}
