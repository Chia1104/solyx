# Main process

Electron's main process. It starts the backend ([`packages/backend/AGENTS.md`](../../../../packages/backend/AGENTS.md)) in a utility process, serves the backend's `Host` port, draws the windows and the tray, and hands each window's port to the backend. It builds no services of its own.

- The app runs as one instance per identity, since a second would run the clock and the order desk again over the same files; a second launch brings the first one's window forward and exits.
- The backend runs in a utility process of this same binary, so the fuses and the code signature that guard the secrets guard it too. As it starts, the main process posts it the facts fixed for the run with two ports: it serves `utility/host.contract.ts` on one and calls `utility/backend.contract.ts` on the other. A port handed over later, a window's or a Fubon process's, goes on the backend's parent port, tagged with what it is.
- Only the main process calls Electron's main-process APIs: `safeStorage`, dialogs, windows, the tray and the Dock, the update feed, `powerMonitor` and starting utility processes. The backend asks for each over the host's port, and reaches the secret store's key only as encryption and decryption done here.
- No window opens before the backend has painted the windows and said its services are built. A restored backup it cannot put in place is told in a dialog, and the app exits.
- If the backend ends while the app runs, the main process records it, reports it, says so in a dialog with how it ended and quits; it never starts the backend again under open windows. Pending reports are sent before the dialog, which holds the main process, since exiting drops what is not sent.
- A record is one JSON file in `<userData>/crashes`, the newest 20 kept: the build, the system, the exit code, Electron's reason and the backend's uncaught error as its type and stack frames with the home folder hidden, never its message, which can carry a key or what the user wrote. Nothing sends a record or backs it up; it is the user's to attach to an issue.
- Quitting gives the backend at most three seconds to store its runs and close what is open.
- The main process reads the config file, for crash-report consent and its dialogs' language, and never writes it.
- Sentry starts here, and the backend's and the renderer's reports pass through it, so every report is scrubbed and held back here until the user agrees.
