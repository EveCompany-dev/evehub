import { config } from 'dotenv';

// See apps/worker/src/load-env.ts for why this is a separate module.
config({ path: ['.env', '../../.env'], quiet: true });
