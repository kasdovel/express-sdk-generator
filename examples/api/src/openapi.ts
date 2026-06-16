// CLI entry point. Importing the route modules populates the global registry;
// we then re-export it. This module is side-effect-free (no server starts).
import './routes.js';

export { registry } from '@sdkgen/core';
