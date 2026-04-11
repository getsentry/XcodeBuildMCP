import {
  activeLogSessions,
  startLogCapture,
  stopAllLogCaptures,
  stopLogCapture,
} from '../log_capture.ts';
import {
  listActiveSimulatorLaunchOsLogSessionIds,
  listActiveSimulatorLaunchOsLogSessions,
  stopAllSimulatorLaunchOsLogSessions,
  stopOwnedSimulatorLaunchOsLogSessions,
  stopSimulatorLaunchOsLogSessionsForApp,
} from './simulator-launch-oslog-sessions.ts';

export type { SubsystemFilter } from '../log_capture.ts';

export function listActiveSimulatorLogSessionIds(): string[] {
  return Array.from(activeLogSessions.keys()).sort();
}

export { startLogCapture, stopLogCapture, stopAllLogCaptures };
export {
  listActiveSimulatorLaunchOsLogSessionIds,
  listActiveSimulatorLaunchOsLogSessions,
  stopAllSimulatorLaunchOsLogSessions,
  stopOwnedSimulatorLaunchOsLogSessions,
  stopSimulatorLaunchOsLogSessionsForApp,
};
