import * as path from 'node:path';
import * as os from 'node:os';

const APP_DIR = path.join(os.homedir(), 'Library', 'Developer', 'XcodeBuildMCP');

export const LOG_DIR = path.join(APP_DIR, 'logs');
export const DERIVED_DATA_DIR = path.join(APP_DIR, 'DerivedData');
