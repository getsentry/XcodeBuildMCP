import fs from 'node:fs';
import path from 'node:path';

const FIXTURES_DIR = path.resolve(process.cwd(), 'src/snapshot-tests/__flowdeck_fixtures__');

export function writeFlowdeckFixture(
  testFilePath: string,
  scenario: string,
  content: string,
): void {
  const workflow = path.basename(testFilePath, '.flowdeck.test.ts');
  const fixturePath = path.join(FIXTURES_DIR, workflow, `${scenario}.txt`);
  const dir = path.dirname(fixturePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fixturePath, content, 'utf8');
}
