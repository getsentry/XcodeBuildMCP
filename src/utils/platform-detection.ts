import { XcodePlatform } from '../types/common.ts';

export type SimulatorPlatform =
  | XcodePlatform.iOSSimulator
  | XcodePlatform.watchOSSimulator
  | XcodePlatform.tvOSSimulator
  | XcodePlatform.visionOSSimulator;
