// Lets plain `tsc` type `.astro` imports (the diagram barrel re-exports them).
declare module "*.astro" {
  const component: (props: Record<string, unknown>) => unknown;

  export default component;
}
