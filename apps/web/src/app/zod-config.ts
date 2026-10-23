import * as z from "zod";

// The CSP forbids eval, which zod would otherwise probe for its JIT parser.
z.config({ jitless: true });
