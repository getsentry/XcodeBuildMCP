import { preflightCommandsWithFocusResign } from '../preflight-commands.ts';

describe('Claude UI benchmark preflight commands', () => {
  it('resigns focus to the target Simulator after launching RocketSim.app', () => {
    expect(
      preflightCommandsWithFocusResign({
        commands: ['killall -9 RocketSim || true', 'sleep 2', 'open -gja RocketSim', 'sleep 10'],
        simulatorId: 'SIM-123',
      }),
    ).toEqual([
      'killall -9 RocketSim || true',
      'sleep 2',
      'open -gja RocketSim',
      "open -a Simulator --args -CurrentDeviceUDID 'SIM-123'",
      'sleep 10',
    ]);
  });

  it('keeps preflight commands unchanged when no target simulator is resolved', () => {
    const commands = ['open -gja RocketSim'];

    expect(preflightCommandsWithFocusResign({ commands })).toBe(commands);
  });

  it('detects simple and path-based RocketSim launch commands', () => {
    expect(
      preflightCommandsWithFocusResign({
        commands: ['open RocketSim', 'open /Applications/RocketSim.app'],
        simulatorId: 'SIM-123',
      }),
    ).toEqual([
      'open RocketSim',
      "open -a Simulator --args -CurrentDeviceUDID 'SIM-123'",
      'open /Applications/RocketSim.app',
      "open -a Simulator --args -CurrentDeviceUDID 'SIM-123'",
    ]);
  });

  it('shell-quotes simulator IDs used by the focus command', () => {
    expect(
      preflightCommandsWithFocusResign({
        commands: ['open -a RocketSim.app'],
        simulatorId: "SIM'123",
      }),
    ).toEqual([
      'open -a RocketSim.app',
      "open -a Simulator --args -CurrentDeviceUDID 'SIM'\"'\"'123'",
    ]);
  });
});
