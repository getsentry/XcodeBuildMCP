import { describe, expect, it } from 'vitest';
import { deviceFamiliesToNumeric, orientationToIOSConstant } from '../ios-scaffold-settings.ts';

describe('iOS scaffold settings', () => {
  it.each([
    ['portrait', 'UIInterfaceOrientationPortrait'],
    ['portrait-upside-down', 'UIInterfaceOrientationPortraitUpsideDown'],
    ['landscape-left', 'UIInterfaceOrientationLandscapeLeft'],
    ['landscape-right', 'UIInterfaceOrientationLandscapeRight'],
  ] as const)('maps %s to its Info.plist constant', (orientation, expected) => {
    expect(orientationToIOSConstant(orientation)).toBe(expected);
  });

  it.each([
    [['iphone'], '1'],
    [['ipad'], '2'],
    [['iphone', 'ipad'], '1,2'],
    [['universal'], '1,2'],
  ] as const)('maps device families %j to %s', (families, expected) => {
    expect(deviceFamiliesToNumeric([...families])).toBe(expected);
  });
});
