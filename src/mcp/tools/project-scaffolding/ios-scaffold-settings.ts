export type IOSDeviceFamily = 'iphone' | 'ipad' | 'universal';

export type IOSOrientation =
  | 'portrait'
  | 'landscape-left'
  | 'landscape-right'
  | 'portrait-upside-down';

const ORIENTATION_CONSTANTS: Record<IOSOrientation, string> = {
  portrait: 'UIInterfaceOrientationPortrait',
  'portrait-upside-down': 'UIInterfaceOrientationPortraitUpsideDown',
  'landscape-left': 'UIInterfaceOrientationLandscapeLeft',
  'landscape-right': 'UIInterfaceOrientationLandscapeRight',
};

/** Converts a scaffold orientation token to its Info.plist build-setting constant. */
export function orientationToIOSConstant(orientation: IOSOrientation): string {
  return ORIENTATION_CONSTANTS[orientation];
}

/** Converts scaffold device-family tokens to Xcode's numeric build-setting value. */
export function deviceFamiliesToNumeric(families: IOSDeviceFamily[]): string {
  if (families.includes('universal')) {
    return '1,2';
  }

  const numericFamilies = new Set<string>();
  if (families.includes('iphone')) {
    numericFamilies.add('1');
  }
  if (families.includes('ipad')) {
    numericFamilies.add('2');
  }
  return [...numericFamilies].join(',');
}
