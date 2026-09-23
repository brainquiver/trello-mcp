// The SDK types its schemas against zod/v4. Importing bare 'zod' gives the v3 API, which
// makes the inference in registerTool explode (TS2589) and runs tsc out of memory.
export { z } from 'zod/v4';
