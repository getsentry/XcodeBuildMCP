/**
 * NSKeyedArchiver Parser for Xcode xcuserstate files
 *
 * Parses binary plist files encoded with NSKeyedArchiver format
 * to extract ActiveScheme and ActiveRunDestination values.
 *
 * Uses bplist-parser for robust binary plist parsing instead of
 * relying on plutil output format which can change between macOS versions.
 */

import { readFileSync } from 'fs';
import { parseBuffer as bplistParseBuffer } from 'bplist-parser';

interface BplistUID {
  UID: number;
}

interface BplistResult {
  $archiver?: string;
  $objects?: unknown[];
  $top?: Record<string, unknown>;
  $version?: number;
}

/** Parsed xcuserstate result */
export interface XcodeStateResult {
  scheme?: string;
  simulatorId?: string;
  simulatorPlatform?: string;
  deviceLocation?: string;
}

/** Represents a dictionary in the NSKeyedArchiver format */
interface ArchivedDict {
  'NS.keys'?: BplistUID[];
  'NS.objects'?: BplistUID[];
  [key: string]: unknown;
}

/**
 * Checks if a value is a bplist UID reference
 */
function isUID(value: unknown): value is BplistUID {
  return (
    typeof value === 'object' &&
    value !== null &&
    'UID' in value &&
    typeof (value as BplistUID).UID === 'number'
  );
}

/**
 * Resolves a UID to its value in the $objects array
 */
function resolveUID(objects: unknown[], uid: BplistUID | unknown): unknown {
  if (!isUID(uid)) return uid;
  const index = uid.UID;
  if (index < 0 || index >= objects.length) return undefined;
  return objects[index];
}

/**
 * Finds the index of a string in the $objects array
 */
function findStringIndex(objects: unknown[], value: string): number {
  return objects.findIndex((obj) => obj === value);
}

/**
 * Finds a dictionary that has the given key index in its NS.keys array
 */
function findDictWithKey(objects: unknown[], keyIndex: number): ArchivedDict | undefined {
  for (const obj of objects) {
    if (typeof obj !== 'object' || obj === null) continue;
    const dict = obj as ArchivedDict;
    const keys = dict['NS.keys'];
    if (!Array.isArray(keys)) continue;

    const hasKey = keys.some((k) => isUID(k) && k.UID === keyIndex);
    if (hasKey) return dict;
  }
  return undefined;
}

/**
 * Gets the value for a key in an NS.keys/NS.objects dictionary
 */
function getValueForKey(objects: unknown[], dict: ArchivedDict, keyIndex: number): unknown {
  const keys = dict['NS.keys'];
  const values = dict['NS.objects'];

  if (!Array.isArray(keys) || !Array.isArray(values)) return undefined;

  const keyPosition = keys.findIndex((k) => isUID(k) && k.UID === keyIndex);
  if (keyPosition === -1 || keyPosition >= values.length) return undefined;

  return resolveUID(objects, values[keyPosition]);
}

/**
 * Main entry point: parses xcuserstate file and extracts Xcode state
 *
 * @param xcuserstatePath - Path to UserInterfaceState.xcuserstate file
 * @returns Extracted scheme and simulator information
 */
export function parseXcuserstate(xcuserstatePath: string): XcodeStateResult {
  const result: XcodeStateResult = {};

  try {
    const buffer = readFileSync(xcuserstatePath);
    const [root] = bplistParseBuffer(buffer) as [BplistResult];

    if (!root || root.$archiver !== 'NSKeyedArchiver' || !Array.isArray(root.$objects)) {
      return result;
    }

    const objects = root.$objects;

    // Find key indices
    const activeSchemeIdx = findStringIndex(objects, 'ActiveScheme');
    const activeRunDestIdx = findStringIndex(objects, 'ActiveRunDestination');
    const ideNameStringIdx = findStringIndex(objects, 'IDENameString');
    const targetDeviceLocationIdx = findStringIndex(objects, 'targetDeviceLocation');

    if (activeSchemeIdx === -1 && activeRunDestIdx === -1) {
      return result;
    }

    const parentKeyIdx = activeSchemeIdx !== -1 ? activeSchemeIdx : activeRunDestIdx;
    const parentDict = findDictWithKey(objects, parentKeyIdx);
    if (!parentDict) {
      return result;
    }

    // Extract scheme name: ActiveScheme -> { IDENameString -> "SchemeName" }
    if (activeSchemeIdx !== -1 && ideNameStringIdx !== -1) {
      const schemeObj = getValueForKey(objects, parentDict, activeSchemeIdx);
      if (typeof schemeObj === 'object' && schemeObj !== null) {
        const schemeDict = schemeObj as ArchivedDict;
        const schemeName = getValueForKey(objects, schemeDict, ideNameStringIdx);
        if (typeof schemeName === 'string') {
          result.scheme = schemeName;
        }
      }
    }

    // Extract run destination: ActiveRunDestination -> { targetDeviceLocation -> "dvtdevice-..." }
    if (activeRunDestIdx !== -1 && targetDeviceLocationIdx !== -1) {
      const destObj = getValueForKey(objects, parentDict, activeRunDestIdx);
      if (typeof destObj === 'object' && destObj !== null) {
        const destDict = destObj as ArchivedDict;
        const location = getValueForKey(objects, destDict, targetDeviceLocationIdx);
        if (typeof location === 'string') {
          result.deviceLocation = location;

          // Extract UUID from location string: "dvtdevice-iphonesimulator:UUID"
          const match = location.match(/dvtdevice-([a-z]+):([A-F0-9-]{36})/i);
          if (match) {
            result.simulatorPlatform = match[1];
            result.simulatorId = match[2];
          }
        }
      }
    }
  } catch (error) {
    // Return empty result on error - this is best-effort parsing
    // that should never crash the server
    console.error('Failed to parse xcuserstate:', error);
  }

  return result;
}

/**
 * Parses xcuserstate from a Buffer (useful for testing with fixtures)
 *
 * @param buffer - Buffer containing the xcuserstate binary plist
 * @returns Extracted scheme and simulator information
 */
export function parseXcuserstateBuffer(buffer: Buffer): XcodeStateResult {
  const result: XcodeStateResult = {};

  try {
    const [root] = bplistParseBuffer(buffer) as [BplistResult];

    if (!root || root.$archiver !== 'NSKeyedArchiver' || !Array.isArray(root.$objects)) {
      return result;
    }

    const objects = root.$objects;

    const activeSchemeIdx = findStringIndex(objects, 'ActiveScheme');
    const activeRunDestIdx = findStringIndex(objects, 'ActiveRunDestination');
    const ideNameStringIdx = findStringIndex(objects, 'IDENameString');
    const targetDeviceLocationIdx = findStringIndex(objects, 'targetDeviceLocation');

    if (activeSchemeIdx === -1 && activeRunDestIdx === -1) {
      return result;
    }

    const parentKeyIdx = activeSchemeIdx !== -1 ? activeSchemeIdx : activeRunDestIdx;
    const parentDict = findDictWithKey(objects, parentKeyIdx);
    if (!parentDict) {
      return result;
    }

    if (activeSchemeIdx !== -1 && ideNameStringIdx !== -1) {
      const schemeObj = getValueForKey(objects, parentDict, activeSchemeIdx);
      if (typeof schemeObj === 'object' && schemeObj !== null) {
        const schemeDict = schemeObj as ArchivedDict;
        const schemeName = getValueForKey(objects, schemeDict, ideNameStringIdx);
        if (typeof schemeName === 'string') {
          result.scheme = schemeName;
        }
      }
    }

    if (activeRunDestIdx !== -1 && targetDeviceLocationIdx !== -1) {
      const destObj = getValueForKey(objects, parentDict, activeRunDestIdx);
      if (typeof destObj === 'object' && destObj !== null) {
        const destDict = destObj as ArchivedDict;
        const location = getValueForKey(objects, destDict, targetDeviceLocationIdx);
        if (typeof location === 'string') {
          result.deviceLocation = location;

          const match = location.match(/dvtdevice-([a-z]+):([A-F0-9-]{36})/i);
          if (match) {
            result.simulatorPlatform = match[1];
            result.simulatorId = match[2];
          }
        }
      }
    }
  } catch (error) {
    console.error('Failed to parse xcuserstate buffer:', error);
  }

  return result;
}

// Export helpers for testing
export { isUID, resolveUID, findStringIndex, findDictWithKey, getValueForKey };
