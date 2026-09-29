import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/user-schema.ts",
  out: "./migrations/user",
});
