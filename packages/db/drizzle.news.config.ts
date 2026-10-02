import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/news-schema.ts",
  out: "./migrations/news",
});
