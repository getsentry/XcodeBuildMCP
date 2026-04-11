import * as path from 'node:path';
import * as os from 'node:os';

export const APP_DIR = path.join(os.homedir(), 'Library', 'Developer', 'XcodeBuildMCP');
export const STATE_DIR = path.join(APP_DIR, 'state');
export const LOG_DIR = path.join(APP_DIR, 'logs');
export const DERIVED_DATA_DIR = path.join(APP_DIR, 'DerivedData');
export const SIMULATOR_LAUNCH_OSLOG_REGISTRY_DIR = path.join(STATE_DIR, 'simulator-launch-oslog');
