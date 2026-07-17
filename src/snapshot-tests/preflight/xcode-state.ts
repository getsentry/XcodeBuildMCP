import { mkdirSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';

const CALCULATOR_SCHEME_XCUSERSTATE =
  'YnBsaXN0MDDUAQIDBAUGBwpYJHZlcnNpb25ZJGFyY2hpdmVyVCR0b3BYJG9iamVjdHMSAAGGoF8QD05TS2V5ZWRBcmNoaXZlctEICVRyb290gAGnCwwVFhwdHlUkbnVsbNMNDg8QEhRXTlMua2V5c1pOUy5vYmplY3RzViRjbGFzc6ERgAKhE4ADgAZcQWN0aXZlU2NoZW1l0w0ODxcZFKEYgAShGoAFgAZdSURFTmFtZVN0cmluZ11DYWxjdWxhdG9yQXBw0h8gISJaJGNsYXNzbmFtZVgkY2xhc3Nlc1xOU0RpY3Rpb25hcnmiISNYTlNPYmplY3QIERokKTI3SUxRU1thaHB7goSGiIqMmaCipKaoqrjGy9bf7O8AAAAAAAABAQAAAAAAAAAkAAAAAAAAAAAAAAAAAAAA+A==';

export function installCalculatorXcodeState(workspacePath: string): void {
  const stateDirectory = join(workspacePath, 'xcuserdata', `${userInfo().username}.xcuserdatad`);
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(
    join(stateDirectory, 'UserInterfaceState.xcuserstate'),
    Buffer.from(CALCULATOR_SCHEME_XCUSERSTATE, 'base64'),
  );
}
