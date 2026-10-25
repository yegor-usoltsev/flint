declare module "*.md" {
  const text: string;
  export default text;
}

declare namespace NodeJS {
  interface ProcessEnv {
    FLINT_COMMIT?: string;
  }
}
