import { config } from 'dotenv';

// Side-effect module, imported first. ES module imports are hoisted, so an
// inline dotenv call in index.ts would run *after* every other import was
// already evaluated. A separate module evaluates in import order instead.
config({ path: ['.env', '../../.env'], quiet: true });
