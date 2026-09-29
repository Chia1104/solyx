import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/cache-schema.ts",
  out: "./migrations/cache",
});
