import { init } from "@sentry/electron/renderer";

// Reports go to the main process, which decides whether to send them and scrubs them first.
// Breadcrumbs are left out here, since it would drop them anyway, rather than handed over on
// every click.
init({
  integrations: (defaults) =>
    defaults.filter(({ name }) => name !== "Breadcrumbs"),
});
