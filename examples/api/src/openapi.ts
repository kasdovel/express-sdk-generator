// CLI entry point. Importing the route modules populates the global registry;
// we then re-export it. This module is side-effect-free (no server starts).
import './routes.js';
import './admin.js';

export { registry } from '@kasdovel/express-sdkgen-core';
