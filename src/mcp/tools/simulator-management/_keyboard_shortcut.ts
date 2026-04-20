import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { log } from '../../../utils/logging/index.ts';

export type KeyboardShortcut = 'software-keyboard' | 'connect-hardware-keyboard';

export type KeyboardShortcutResult = { success: true } | { success: false; error: string };

type SimctlDevice = { udid: string; name: string; state: string };
type SimctlList = { devices: Record<string, SimctlDevice[]> };

function escapeAppleScriptStringLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function resolveDevice(list: SimctlList, simulatorId: string): SimctlDevice | undefined {
  for (const runtime in list.devices) {
    const found = list.devices[runtime]?.find((d) => d.udid === simulatorId);
    if (found) return found;
  }
  return undefined;
}

function buildFocusScript(deviceName: string): string {
  const safeName = escapeAppleScriptStringLiteral(deviceName);
  return [
    'tell application "System Events"',
    '  tell process "Simulator"',
    '    set frontmost to true',
    '    set matchingWindows to (every window whose (title is "' +
      safeName +
      '" or title starts with "' +
      safeName +
      ' –" or title starts with "' +
      safeName +
      ' -"))',
    '    if (count of matchingWindows) is 0 then',
    '      return "NO_WINDOW"',
    '    end if',
    '    perform action "AXRaise" of (item 1 of matchingWindows)',
    '    return "OK"',
    '  end tell',
    'end tell',
  ].join('\n');
}

function buildKeystrokeScript(shortcut: KeyboardShortcut): string {
  const modifiers =
    shortcut === 'connect-hardware-keyboard' ? '{command down, shift down}' : '{command down}';
  return [
    'tell application "System Events"',
    '  tell process "Simulator"',
    '    keystroke "k" using ' + modifiers,
    '  end tell',
    'end tell',
  ].join('\n');
}

export async function sendKeyboardShortcut(
  simulatorId: string,
  shortcut: KeyboardShortcut,
  executor: CommandExecutor,
): Promise<KeyboardShortcutResult> {
  log('info', `Sending keyboard shortcut "${shortcut}" to simulator ${simulatorId}`);

  const listResult = await executor(
    ['xcrun', 'simctl', 'list', 'devices', '--json'],
    'List Simulators',
    false,
  );
  if (!listResult.success) {
    return {
      success: false,
      error: `Failed to list simulators: ${listResult.error ?? 'unknown error'}`,
    };
  }

  let parsed: SimctlList;
  try {
    parsed = JSON.parse(listResult.output) as SimctlList;
  } catch (e) {
    return {
      success: false,
      error: `Failed to parse simulator list: ${(e as Error).message}`,
    };
  }

  const device = resolveDevice(parsed, simulatorId);
  if (!device) {
    return {
      success: false,
      error: `Simulator ${simulatorId} not found. Use list_sims to see available simulators.`,
    };
  }

  if (device.state !== 'Booted') {
    return {
      success: false,
      error: `Simulator ${simulatorId} is not booted. Boot it first with boot_sim.`,
    };
  }

  const openResult = await executor(['open', '-a', 'Simulator'], 'Open Simulator App', false);
  if (!openResult.success) {
    return {
      success: false,
      error: `Failed to open Simulator app: ${openResult.error ?? 'unknown error'}`,
    };
  }

  const focusResult = await executor(
    ['osascript', '-e', buildFocusScript(device.name)],
    'Focus Simulator Window',
    false,
  );
  if (!focusResult.success) {
    return {
      success: false,
      error: `Failed to focus Simulator window: ${focusResult.error ?? 'unknown error'}`,
    };
  }

  if (focusResult.output.trim() === 'NO_WINDOW') {
    return {
      success: false,
      error: `No Simulator window found for "${device.name}". Is the simulator window visible?`,
    };
  }

  const keystrokeResult = await executor(
    ['osascript', '-e', buildKeystrokeScript(shortcut)],
    'Send Keyboard Shortcut',
    false,
  );
  if (!keystrokeResult.success) {
    return {
      success: false,
      error: `Failed to send keyboard shortcut: ${keystrokeResult.error ?? 'unknown error'}`,
    };
  }

  return { success: true };
}
