import { rmSyncWithRetries } from './fs-retry.mjs';

rmSyncWithRetries('dist', { recursive: true, force: true });
