import { join } from 'path';
import { log } from './logger.ts';
import type { CommandExecutor } from './command.ts';
import type { FileSystemExecutor } from './FileSystemExecutor.ts';
import { getConfig } from './config-store.ts';

/**
 * Template manager for resolving locally configured project templates.
 */
export class TemplateManager {
  /**
   * Get the template path for a specific platform.
   */
  static async getTemplatePath(
    platform: 'iOS' | 'macOS',
    _commandExecutor: CommandExecutor,
    fileSystemExecutor: FileSystemExecutor,
  ): Promise<string> {
    const config = getConfig();
    const localPath = platform === 'iOS' ? config.iosTemplatePath : config.macosTemplatePath;
    log(
      'debug',
      `[TemplateManager] Checking config override for ${platform} template. Value: '${localPath}'`,
    );

    if (localPath) {
      const pathExists = fileSystemExecutor.existsSync(localPath);
      log(
        'debug',
        `[TemplateManager] Config override set. Path '${localPath}' exists? ${pathExists}`,
      );
      if (pathExists) {
        const templateSubdir = join(localPath, 'template');
        const subdirExists = fileSystemExecutor.existsSync(templateSubdir);
        log(
          'debug',
          `[TemplateManager] Checking for subdir '${templateSubdir}'. Exists? ${subdirExists}`,
        );
        if (subdirExists) {
          log('info', `Using local ${platform} template from: ${templateSubdir}`);
          return templateSubdir;
        }

        throw new Error(
          `Configured ${platform} template path must contain a template subdirectory: ${templateSubdir}`,
        );
      }

      throw new Error(`Configured ${platform} template path does not exist: ${localPath}`);
    }

    const envVar =
      platform === 'iOS' ? 'XCODEBUILDMCP_IOS_TEMPLATE_PATH' : 'XCODEBUILDMCP_MACOS_TEMPLATE_PATH';
    const configKey = platform === 'iOS' ? 'iosTemplatePath' : 'macosTemplatePath';
    throw new Error(
      [
        `No local ${platform} template path configured.`,
        'This no-telemetry fork does not download project templates.',
        `Set ${envVar} or ${configKey} to a directory containing a template/ subdirectory.`,
      ].join(' '),
    );
  }

  /**
   * No-op cleanup retained for callers that previously cleaned downloaded templates.
   */
  static async cleanup(
    _templatePath: string,
    _fileSystemExecutor: FileSystemExecutor,
  ): Promise<void> {
    return Promise.resolve();
  }
}
