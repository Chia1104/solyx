# Main process

Electron's main process. It starts the backend ([`../backend/AGENTS.md`](../backend/AGENTS.md)) in a utility process, serves the backend's `Host` port, draws the windows and the tray, and hands each window's port to the backend. It builds no services of its own.

- The app runs as one instance per identity, since a second would run the clock and the order desk again over the same files; a second launch brings the first one's window forward and exits.
- The backend runs in a utility process of this same binary, so the fuses and the code signature that guard the secrets guard it too. As it starts, the main process posts it the facts fixed for the run with two ports: on one it serves `utility/host.contract.ts`, and on the other it calls `utility/backend.contract.ts`. A port it hands over later, a window's or a Fubon process's, goes on the backend's parent port, tagged with what it is.
- Only the main process calls Electron's main-process APIs: `safeStorage`, dialogs, windows, the tray and the Dock, the update feed, `powerMonitor` and starting utility processes. The backend asks for each over the host's port, and reaches the secret store's key only as encryption and decryption done here.
- No window opens before the backend has painted the windows and said its services are built. A restored backup it cannot put in place is told in a dialog, and the app exits.
- The backend ending while the app runs leaves the windows nothing to ask, so the main process reports it, says so in a dialog and quits; it never starts the backend again under open windows.
- Quitting asks the backend to store its runs and close what is open, for three seconds at most, before the app quits.
- The main process reads the config file, for whether crash reports may be sent and the language of its own dialogs, and never writes it.
- Sentry starts here, and the backend's and the renderer's reports pass through it, so every report is scrubbed and held back here until the user agrees.
