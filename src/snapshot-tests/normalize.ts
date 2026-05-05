/* eslint-disable no-control-regex, no-regex-spaces */
import os from 'node:os';
import path from 'node:path';

const ANSI_REGEX = /\x1B\[[0-9;]*[mK]/g;
const ISO_TIMESTAMP_REGEX = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/g;
const LOG_FILENAME_TIMESTAMP_REGEX = /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/g;
const APPLE_DEVICE_UDID_REGEX = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}/g;
const UUID_REGEX = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g;
const DURATION_REGEX = /\d+\.\d+s\b/g;
const PID_NUMBER_REGEX = /(pid:\s*)\d+/gi;
const PID_FILENAME_SUFFIX_REGEX = /_pid\d+(?:_[0-9a-f]{8})?\.log/g;
const HELPER_PID_FILENAME_SUFFIX_REGEX =
  /_(?:helperpid\d+_ownerpid\d+|ownerpid\d+)_[0-9a-f]{8}\.log/g;
const PID_JSON_REGEX = /"pid"\s*:\s*\d+/g;
const PROCESS_ID_REGEX = /Process ID: \d+/g;
const PROCESS_INLINE_PID_REGEX = /process \d+/g;
const CLI_PROCESS_ID_ARG_REGEX = /--process-id "\d+"/g;
const MCP_PROCESS_ID_ARG_REGEX = /(processId:\s*)\d+/g;
const THREAD_ID_REGEX = /Thread \d{5,}/g;
const HEX_ADDRESS_REGEX = /0x[0-9a-fA-F]{8,}/g;

const LLDB_FRAME_OFFSET_REGEX = /(`[^`\n]+):(\d+)$/gm;
const LLDB_SYS_FRAME_FUNC_REGEX =
  /(frame #\d+: )\S+( at (?:\/usr\/lib\/|\/Library\/Developer\/CoreSimulator\/)[^`\n]*`)[^:\n]+(:<OFFSET>)/gm;
const LLDB_FRAME_NUMBER_REGEX = /  frame #\d+:/g;
const LLDB_BREAKPOINT_LOCATIONS_REGEX = /locations = .+$/gm;
const DERIVED_DATA_HASH_REGEX = /(DerivedData\/[^/\s]+)-(?:[a-z]{28}|[0-9a-f]{12})(?=\/|\b)/g;
const LOCAL_TIMESTAMP_REGEX = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/g;
const XCTEST_PARENS_DURATION_REGEX = /\(\d+\.\d+\) seconds/g;
const SWIFT_TESTING_DURATION_REGEX = /after \d+\.\d+ seconds/g;
const TEST_SUMMARY_COUNTS_REGEX =
  /\(Total: \d+(?:, Passed: \d+)?(?:, Failed: \d+)?(?:, Skipped: \d+)?, /g;
const COVERAGE_CALL_COUNT_REGEX = /called \d+x\)/g;
const DEVICE_LABEL_REGEX = /Device: .+ \(<UUID>\)/g;
const UPTIME_REGEX = /Uptime: \d+s/g;
const RESULT_BUNDLE_LINE_REGEX = /\S+\[\d+:\d+\] Writing error result bundle to \S+/g;
const DEVICE_TRANSPORT_TYPE_REGEX = /\b(wired|localNetwork)\b/g;
const TARGET_DEVICE_IDENTIFIER_REGEX = /(TARGET_DEVICE_IDENTIFIER = )([0-9A-Fa-f]{24,40})/g;
const CODEX_ARG0_PATH_REGEX = /<HOME>\/\.codex\/tmp\/arg0\/codex-arg0[A-Za-z0-9]+/g;
const CODEX_WORKTREE_NODE_MODULES_REGEX =
  /<HOME>\/\.codex\/worktrees\/[^/:]+\/node_modules\/\.bin/g;
const ACQUIRED_USAGE_ASSERTION_TIME_REGEX =
  /(^\s*)\d{2}:\d{2}:\d{2}( {2}Acquired usage assertion\.)$/gm;
const BUILD_SETTINGS_PATH_REGEX = /^( {6}PATH = ).+$/gm;
const TRAILING_WHITESPACE_REGEX = /[ \t]+$/gm;
const SIMULATOR_FAILURE_TEST_PROGRESS_BLOCK_REGEX =
  /(?:^Running tests \(\d+ completed, \d+ failures?, \d+ skipped\)\n){30,}/gm;
const TEST_PROGRESS_LINE_REGEX =
  /^Running tests \((\d+) completed, (\d+) failures?, (\d+) skipped\)$/u;

type TestProgress = { completed: number; failed: number; skipped: number };

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTestProgressLine(line: string): TestProgress | null {
  const match = line.match(TEST_PROGRESS_LINE_REGEX);
  if (!match) {
    return null;
  }

  return {
    completed: Number(match[1]),
    failed: Number(match[2]),
    skipped: Number(match[3]),
  };
}

function isMonotonicProgress(progress: TestProgress[]): boolean {
  return progress.every((current, index) => {
    const previous = progress[index - 1];
    return (
      previous === undefined ||
      (current.completed >= previous.completed &&
        current.failed >= previous.failed &&
        current.skipped >= previous.skipped)
    );
  });
}

function normalizeSimulatorFailureTestProgressBlock(match: string): string {
  const progress = match.trimEnd().split('\n').map(parseTestProgressLine);
  const parsedProgress = progress.filter((line): line is TestProgress => line !== null);
  if (parsedProgress.length !== progress.length) {
    return match;
  }
  const first = parsedProgress[0];
  const final = parsedProgress.at(-1);
  if (!first || !final) {
    return match;
  }

  const hasCleanStart = first.completed <= 1 && first.failed === 0 && first.skipped === 0;
  if (!hasCleanStart || final.failed === 0 || !isMonotonicProgress(parsedProgress)) {
    return match;
  }

  return `Running tests (<TEST_PROGRESS>; final: ${final.completed} completed, ${final.failed} failed, ${final.skipped} skipped)\n`;
}

export function normalizeSnapshotOutput(text: string): string {
  let normalized = text;

  normalized = normalized.replace(ANSI_REGEX, '');

  const projectRoot = path.resolve(process.cwd());
  normalized = normalized.replace(new RegExp(escapeRegex(projectRoot), 'g'), '<ROOT>');

  const home = os.homedir();
  normalized = normalized.replace(new RegExp(escapeRegex(home), 'g'), '<HOME>');
  normalized = normalized.replace(/~\//g, '<HOME>/');
  normalized = normalized.replace(/(?<=\s|:)~(?=\s|$)/gm, '<HOME>');

  const username = os.userInfo().username;
  normalized = normalized.replace(
    new RegExp(
      `((?:ALTERNATE_OWNER|INSTALL_OWNER|USER|VERSION_INFO_BUILDER)\\s*=\\s*)${escapeRegex(username)}`,
      'g',
    ),
    '$1<USER>',
  );
  normalized = normalized.replace(new RegExp(`(UID\\s*=\\s*)${os.userInfo().uid}`, 'g'), '$1<UID>');

  const tmpDir = os.tmpdir();
  normalized = normalized.replace(
    new RegExp(escapeRegex(tmpDir) + '/[A-Za-z0-9._-]+(?=/|[^A-Za-z0-9._/-]|$)', 'g'),
    '<TMPDIR>',
  );
  normalized = normalized.replace(
    /(<HOME>\/Library\/Developer\/XcodeBuildMCP\/workspaces\/[^/]+)-[0-9a-f]{12}(?=\/logs\/)/g,
    '$1-<HASH>',
  );
  normalized = normalized.replace(
    /(<HOME>\/Library\/Developer\/XcodeBuildMCP\/workspaces\/[^/]+)-[0-9a-f]{12}\/DerivedData(?=$|[^A-Za-z0-9])/g,
    '$1-<HASH>/DerivedData',
  );
  normalized = normalized.replace(
    /(Build Logs: )(?:<TMPDIR>|<HOME>\/Library\/Developer\/XcodeBuildMCP)\/logs\//g,
    '$1<HOME>/Library/Developer/XcodeBuildMCP/logs/',
  );

  normalized = normalized.replace(DERIVED_DATA_HASH_REGEX, '$1-<HASH>');
  normalized = normalized.replace(ISO_TIMESTAMP_REGEX, '<TIMESTAMP>');
  normalized = normalized.replace(LOG_FILENAME_TIMESTAMP_REGEX, '<TIMESTAMP>');
  normalized = normalized.replace(APPLE_DEVICE_UDID_REGEX, '<UUID>');
  normalized = normalized.replace(UUID_REGEX, '<UUID>');
  normalized = normalized.replace(DEVICE_LABEL_REGEX, 'Device: <DEVICE> (<UUID>)');
  normalized = normalized.replace(DEVICE_TRANSPORT_TYPE_REGEX, '<CONNECTION>');
  normalized = normalized.replace(DURATION_REGEX, '<DURATION>');
  normalized = normalized.replace(PID_NUMBER_REGEX, '$1<PID>');
  normalized = normalized.replace(HELPER_PID_FILENAME_SUFFIX_REGEX, '_pid<PID>.log');
  normalized = normalized.replace(PID_FILENAME_SUFFIX_REGEX, '_pid<PID>.log');
  normalized = normalized.replace(PID_JSON_REGEX, '"pid" : <PID>');
  normalized = normalized.replace(PROCESS_ID_REGEX, 'Process ID: <PID>');
  normalized = normalized.replace(PROCESS_INLINE_PID_REGEX, 'process <PID>');
  normalized = normalized.replace(CLI_PROCESS_ID_ARG_REGEX, '--process-id "<PID>"');
  normalized = normalized.replace(MCP_PROCESS_ID_ARG_REGEX, '$1<PID>');
  normalized = normalized.replace(UPTIME_REGEX, 'Uptime: <UPTIME>');

  // Normalize simulator/device state markers and boot state text
  normalized = normalized.replace(/\[✓\]/g, '[<STATUS>]');
  normalized = normalized.replace(/\[✗\]/g, '[<STATUS>]');
  normalized = normalized.replace(/\(Booted\)/g, '(<SIM_STATE>)');
  normalized = normalized.replace(/\(Shutdown\)/g, '(<SIM_STATE>)');

  normalized = normalized.replace(THREAD_ID_REGEX, 'Thread <THREAD_ID>');
  normalized = normalized.replace(HEX_ADDRESS_REGEX, '<ADDR>');
  normalized = normalized.replace(LLDB_FRAME_OFFSET_REGEX, '$1:<OFFSET>');
  normalized = normalized.replace(LLDB_SYS_FRAME_FUNC_REGEX, '$1<FUNC>$2<FUNC>$3');
  normalized = normalized.replace(LLDB_FRAME_NUMBER_REGEX, '  frame #<N>:');
  normalized = normalized.replace(LLDB_BREAKPOINT_LOCATIONS_REGEX, 'locations = <LOCATIONS>');
  normalized = normalized.replace(RESULT_BUNDLE_LINE_REGEX, '<RESULT_BUNDLE_ERROR>');

  normalized = normalized.replace(LOCAL_TIMESTAMP_REGEX, '<TIMESTAMP>');
  normalized = normalized.replace(XCTEST_PARENS_DURATION_REGEX, '(<DURATION>) seconds');
  normalized = normalized.replace(SWIFT_TESTING_DURATION_REGEX, 'after <DURATION> seconds');
  normalized = normalized.replace(TEST_SUMMARY_COUNTS_REGEX, '(<TEST_COUNTS>, ');

  normalized = normalized.replace(TARGET_DEVICE_IDENTIFIER_REGEX, '$1<UUID>');
  normalized = normalized.replace(BUILD_SETTINGS_PATH_REGEX, '$1<PATH>');
  normalized = normalized.replace(CODEX_ARG0_PATH_REGEX, '<HOME>/.codex/tmp/arg0/codex-arg0<ARG0>');
  normalized = normalized.replace(ACQUIRED_USAGE_ASSERTION_TIME_REGEX, '$1<TIME>$2');
  normalized = normalized.replace(
    CODEX_WORKTREE_NODE_MODULES_REGEX,
    '<HOME>/.codex/worktrees/<WORKTREE>/node_modules/.bin',
  );

  normalized = normalized.replace(COVERAGE_CALL_COUNT_REGEX, 'called <N>x)');

  normalized = normalized.replace(
    SIMULATOR_FAILURE_TEST_PROGRESS_BLOCK_REGEX,
    normalizeSimulatorFailureTestProgressBlock,
  );

  // Normalize final test summary line (counts vary across environments)
  normalized = normalized.replace(
    /\d+ (tests? failed), \d+ (passed)(?:, \d+ (skipped))?/g,
    '<FAIL_COUNT> $1, <PASS_COUNT> $2, <SKIP_COUNT> skipped',
  );

  normalized = normalized.replace(
    /("(?:x|y|width|height)"\s*:\s*)(\d+\.\d{2,})/g,
    (_match: string, prefix: string, num: string) => `${prefix}${parseFloat(num).toFixed(1)}`,
  );

  // Round floats embedded in AXFrame strings like `{{19.5, 357.5}, {82.666664123535156, 81}}`
  // to 1 decimal for rounding-stable comparison.
  normalized = normalized.replace(
    /("AXFrame"\s*:\s*")([^"]*)(")/g,
    (_match: string, prefix: string, value: string, suffix: string) =>
      `${prefix}${value.replace(/(\d+)\.(\d{2,})/g, (__, intPart: string, fracPart: string) => {
        const parsed = parseFloat(`${intPart}.${fracPart}`);
        return (Math.round(parsed * 10) / 10).toString();
      })}${suffix}`,
  );

  normalized = normalized.replace(
    /(?<=Workspace root: )(?:<ROOT>\/[^\n]+|(?!\/)[^\n]+)/g,
    '<PATH>',
  );
  normalized = normalized.replace(/(?<=Scan path: )(?:<ROOT>\/[^\n]+|(?!\/)[^\n]+)/g, '<PATH>');

  // Doctor-specific sanitization for volatile system information
  normalized = normalized.replace(/  version: v[\d.]+/g, '  version: <NODE_VERSION>');
  normalized = normalized.replace(/^(  release: )[\d.]+/gm, '$1<OS_RELEASE>');
  normalized = normalized.replace(/^(  cpus: ).+/gm, '$1<CPUS>');
  normalized = normalized.replace(/^(  memory: ).+/gm, '$1<MEMORY>');
  normalized = normalized.replace(/^(  tmpdir: )\/var\/folders\/[^\n]+/gm, '$1<TMPDIR>');
  normalized = normalized.replace(/^(  homedir: )[^\n]+/gm, '$1<HOME>');
  normalized = normalized.replace(/  Server Version: [\d.]+[^\n]*/g, '  Server Version: <VERSION>');
  normalized = normalized.replace(/  tmpdir: \/var\/folders\/[^\n]+/g, '  tmpdir: <TMPDIR>');
  normalized = normalized.replace(/  TMPDIR: \/var\/folders\/[^\n]+/g, '  TMPDIR: <TMPDIR>');
  normalized = normalized.replace(
    /  version: Xcode [\d.]+ - Build version \w+/g,
    '  version: <XCODE_VERSION>',
  );
  normalized = normalized.replace(/  path: \/Applications\/Xcode[^\n]+/g, '  path: <XCODE_PATH>');
  normalized = normalized.replace(
    /  selectedXcode: \/Applications\/Xcode[^\n]+/g,
    '  selectedXcode: <XCODE_PATH>',
  );
  normalized = normalized.replace(/  xcrunVersion: xcrun version .+/g, '  xcrunVersion: <VERSION>');
  normalized = normalized.replace(/  axe: v?[\d.]+[^\n]*/g, '  axe: <VERSION>');
  normalized = normalized.replace(/  mise: v?[\d.]+[^\n]*/g, '  mise: <VERSION>');
  normalized = normalized.replace(
    /  mcpbridge path: \/Applications\/Xcode[^\n]+/g,
    '  mcpbridge path: <XCODE_PATH>',
  );
  normalized = normalized.replace(/^( {2}Xcode running: ).+$/gm, '$1<XCODE_RUNNING>');
  normalized = normalized.replace(/  Total Unique Tools: \d+/g, '  Total Unique Tools: <COUNT>');
  normalized = normalized.replace(/  Workflow Count: \d+/g, '  Workflow Count: <COUNT>');
  normalized = normalized.replace(/  (\w[\w-]*): \d+ tools$/gm, '  $1: <N> tools');
  normalized = normalized.replace(/  cwd: [^\n]+/g, '  cwd: <CWD>');
  normalized = normalized.replace(
    /Simulator Video Capture Supported \(AXe >= [\d.]+\): (?:Yes|No)/g,
    'Simulator Video Capture Supported (AXe >= <VERSION>): <AVAILABLE>',
  );

  // PATH section body: every entry is an absolute system path that varies by
  // host/user. Replace the entire body with a single stable placeholder.
  normalized = normalized.replace(/(\nPATH\n)(?:  [^\n]+\n)+/g, '$1  <PATH_ENTRIES>\n');

  normalized = normalized.replace(TRAILING_WHITESPACE_REGEX, '');
  normalized = normalized.replace(/\n*$/, '\n');

  return normalized;
}
