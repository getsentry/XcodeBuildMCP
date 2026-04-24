import * as z from 'zod';
import { join, dirname, basename } from 'node:path';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import { ValidationError } from '../../../utils/errors.ts';
import { TemplateManager } from '../../../utils/template/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { createScaffoldDomainResult, setScaffoldStructuredOutput } from './domain-result.ts';

const BaseScaffoldSchema = z.object({
  projectName: z.string().min(1),
  outputPath: z.string(),
  bundleIdentifier: z.string().optional(),
  displayName: z.string().optional(),
  marketingVersion: z.string().optional(),
  currentProjectVersion: z.string().optional(),
  customizeNames: z.boolean().default(true),
});

const ScaffoldiOSProjectSchema = BaseScaffoldSchema.extend({
  deploymentTarget: z.string().optional(),
  targetedDeviceFamily: z.array(z.enum(['iphone', 'ipad', 'universal'])).optional(),
  supportedOrientations: z
    .array(z.enum(['portrait', 'landscape-left', 'landscape-right', 'portrait-upside-down']))
    .optional(),
  supportedOrientationsIpad: z
    .array(z.enum(['portrait', 'landscape-left', 'landscape-right', 'portrait-upside-down']))
    .optional(),
});

/**
 * Convert orientation enum to iOS constant
 */
function orientationToIOSConstant(orientation: string): string {
  switch (orientation) {
    case 'Portrait':
      return 'UIInterfaceOrientationPortrait';
    case 'PortraitUpsideDown':
      return 'UIInterfaceOrientationPortraitUpsideDown';
    case 'LandscapeLeft':
      return 'UIInterfaceOrientationLandscapeLeft';
    case 'LandscapeRight':
      return 'UIInterfaceOrientationLandscapeRight';
    default:
      return orientation;
  }
}

/**
 * Convert device family enum to numeric value
 */
function deviceFamilyToNumeric(family: string): string {
  switch (family) {
    case 'iPhone':
      return '1';
    case 'iPad':
      return '2';
    case 'iPhone+iPad':
      return '1,2';
    default:
      return '1,2';
  }
}

/**
 * Update Package.swift file with deployment target
 */
function updatePackageSwiftFile(content: string, params: Record<string, unknown>): string {
  let result = content;

  const projectName = params.projectName as string;
  const platform = params.platform as string;
  const deploymentTarget = params.deploymentTarget as string | undefined;

  // Update ALL target name references in Package.swift
  const featureName = `${projectName}Feature`;
  const testName = `${projectName}FeatureTests`;

  // Replace ALL occurrences of MyProjectFeatureTests first (more specific)
  result = result.replace(/MyProjectFeatureTests/g, testName);
  // Then replace ALL occurrences of MyProjectFeature (less specific, so comes after)
  result = result.replace(/MyProjectFeature/g, featureName);

  // Update deployment targets based on platform
  if (platform === 'iOS') {
    if (deploymentTarget) {
      // Extract major version (e.g., "17.0" -> "17")
      const majorVersion = deploymentTarget.split('.')[0];
      result = result.replace(/\.iOS\(\.v\d+\)/, `.iOS(.v${majorVersion})`);
    }
  }

  return result;
}

/**
 * Update XCConfig file with scaffold parameters
 */
function updateXCConfigFile(content: string, params: Record<string, unknown>): string {
  let result = content;

  const projectName = params.projectName as string;
  const displayName = params.displayName as string | undefined;
  const bundleIdentifier = params.bundleIdentifier as string | undefined;
  const marketingVersion = params.marketingVersion as string | undefined;
  const currentProjectVersion = params.currentProjectVersion as string | undefined;
  const platform = params.platform as string;
  const deploymentTarget = params.deploymentTarget as string | undefined;
  const targetedDeviceFamily = params.targetedDeviceFamily as string | undefined;
  const supportedOrientations = params.supportedOrientations as string[] | undefined;
  const supportedOrientationsIpad = params.supportedOrientationsIpad as string[] | undefined;

  // Update project identity settings
  result = result.replace(/PRODUCT_NAME = .+/g, `PRODUCT_NAME = ${projectName}`);
  result = result.replace(
    /PRODUCT_DISPLAY_NAME = .+/g,
    `PRODUCT_DISPLAY_NAME = ${displayName ?? projectName}`,
  );
  result = result.replace(
    /PRODUCT_BUNDLE_IDENTIFIER = .+/g,
    `PRODUCT_BUNDLE_IDENTIFIER = ${bundleIdentifier ?? `io.sentry.${projectName.toLowerCase().replace(/[^a-z0-9]/g, '')}`}`,
  );
  result = result.replace(
    /MARKETING_VERSION = .+/g,
    `MARKETING_VERSION = ${marketingVersion ?? '1.0'}`,
  );
  result = result.replace(
    /CURRENT_PROJECT_VERSION = .+/g,
    `CURRENT_PROJECT_VERSION = ${currentProjectVersion ?? '1'}`,
  );

  // Platform-specific updates
  if (platform === 'iOS') {
    // iOS deployment target
    if (deploymentTarget) {
      result = result.replace(
        /IPHONEOS_DEPLOYMENT_TARGET = .+/g,
        `IPHONEOS_DEPLOYMENT_TARGET = ${deploymentTarget}`,
      );
    }

    // Device family
    if (targetedDeviceFamily) {
      const deviceFamilyValue = deviceFamilyToNumeric(targetedDeviceFamily);
      result = result.replace(
        /TARGETED_DEVICE_FAMILY = .+/g,
        `TARGETED_DEVICE_FAMILY = ${deviceFamilyValue}`,
      );
    }

    // iPhone orientations
    if (supportedOrientations && supportedOrientations.length > 0) {
      // Filter out any empty strings and validate
      const validOrientations = supportedOrientations.filter((o: string) => o && o.trim() !== '');
      if (validOrientations.length > 0) {
        const orientations = validOrientations.map(orientationToIOSConstant).join(' ');
        result = result.replace(
          /INFOPLIST_KEY_UISupportedInterfaceOrientations = .+/g,
          `INFOPLIST_KEY_UISupportedInterfaceOrientations = ${orientations}`,
        );
      }
    }

    // iPad orientations
    if (supportedOrientationsIpad && supportedOrientationsIpad.length > 0) {
      // Filter out any empty strings and validate
      const validOrientations = supportedOrientationsIpad.filter(
        (o: string) => o && o.trim() !== '',
      );
      if (validOrientations.length > 0) {
        const orientations = validOrientations.map(orientationToIOSConstant).join(' ');
        result = result.replace(
          /INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = .+/g,
          `INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = ${orientations}`,
        );
      }
    }

    // Update entitlements path for iOS
    result = result.replace(
      /CODE_SIGN_ENTITLEMENTS = .+/g,
      `CODE_SIGN_ENTITLEMENTS = Config/${projectName}.entitlements`,
    );
  }

  // Update test bundle identifier and target name
  result = result.replace(/TEST_TARGET_NAME = .+/g, `TEST_TARGET_NAME = ${projectName}`);

  // Update comments that reference MyProject in entitlements paths
  result = result.replace(/Config\/MyProject\.entitlements/g, `Config/${projectName}.entitlements`);

  return result;
}

/**
 * Replace placeholders in a string (for non-XCConfig files)
 */
function replacePlaceholders(
  content: string,
  projectName: string,
  bundleIdentifier: string,
): string {
  let result = content;

  // Replace project name
  result = result.replace(/MyProject/g, projectName);

  // Replace bundle identifier - check for both patterns used in templates
  if (bundleIdentifier) {
    result = result.replace(/com\.example\.MyProject/g, bundleIdentifier);
    result = result.replace(/com\.mycompany\.MyProject/g, bundleIdentifier);
  }

  return result;
}

/**
 * Process a single file, replacing placeholders if it's a text file
 */
async function processFile(
  sourcePath: string,
  destPath: string,
  params: Record<string, unknown>,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<void> {
  const projectName = params.projectName as string;
  const bundleIdentifierParam = params.bundleIdentifier as string | undefined;
  const customizeNames = params.customizeNames as boolean | undefined;

  // Determine the destination file path
  let finalDestPath = destPath;
  if (customizeNames) {
    // Replace MyProject in file/directory names
    const fileName = basename(destPath);
    const dirName = dirname(destPath);
    const newFileName = fileName.replace(/MyProject/g, projectName);
    finalDestPath = join(dirName, newFileName);
  }

  // Text file extensions that should be processed
  const textExtensions = [
    '.swift',
    '.h',
    '.m',
    '.mm',
    '.cpp',
    '.c',
    '.pbxproj',
    '.plist',
    '.xcscheme',
    '.xctestplan',
    '.xcworkspacedata',
    '.xcconfig',
    '.json',
    '.xml',
    '.entitlements',
    '.storyboard',
    '.xib',
    '.md',
  ];

  const ext = sourcePath.toLowerCase();
  const isTextFile = textExtensions.some((textExt) => ext.endsWith(textExt));
  const isXCConfig = sourcePath.endsWith('.xcconfig');
  const isPackageSwift = sourcePath.endsWith('Package.swift');

  if (isTextFile && customizeNames) {
    // Read the file content
    const content = await fileSystemExecutor.readFile(sourcePath, 'utf-8');

    let processedContent;

    if (isXCConfig) {
      // Use special XCConfig processing
      processedContent = updateXCConfigFile(content, params);
    } else if (isPackageSwift) {
      // Use special Package.swift processing
      processedContent = updatePackageSwiftFile(content, params);
    } else {
      // Use standard placeholder replacement
      const bundleIdentifier =
        bundleIdentifierParam ?? `io.sentry.${projectName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      processedContent = replacePlaceholders(content, projectName, bundleIdentifier);
    }

    await fileSystemExecutor.mkdir(dirname(finalDestPath), { recursive: true });
    await fileSystemExecutor.writeFile(finalDestPath, processedContent, 'utf-8');
  } else {
    // Copy binary files as-is
    await fileSystemExecutor.mkdir(dirname(finalDestPath), { recursive: true });
    await fileSystemExecutor.cp(sourcePath, finalDestPath);
  }
}

/**
 * Recursively process a directory
 */
async function processDirectory(
  sourceDir: string,
  destDir: string,
  params: Record<string, unknown>,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<void> {
  const entries = await fileSystemExecutor.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryTyped = entry as { name: string; isDirectory: () => boolean; isFile: () => boolean };
    const sourcePath = join(sourceDir, entryTyped.name);
    let destName = entryTyped.name;

    if (params.customizeNames) {
      // Replace MyProject in directory names
      destName = destName.replace(/MyProject/g, params.projectName as string);
    }

    const destPath = join(destDir, destName);

    if (entryTyped.isDirectory()) {
      // Skip certain directories
      if (entryTyped.name === '.git' || entryTyped.name === 'xcuserdata') {
        continue;
      }
      await fileSystemExecutor.mkdir(destPath, { recursive: true });
      await processDirectory(sourcePath, destPath, params, fileSystemExecutor);
    } else if (entryTyped.isFile()) {
      // Skip certain files
      if (entryTyped.name === '.DS_Store' || entryTyped.name.endsWith('.xcuserstate')) {
        continue;
      }
      await processFile(sourcePath, destPath, params, fileSystemExecutor);
    }
  }
}

type ScaffoldIOSProjectParams = z.infer<typeof ScaffoldiOSProjectSchema>;
type ScaffoldIOSProjectResult = ReturnType<typeof createScaffoldDomainResult>;

export function createScaffoldIOSProjectExecutor(
  commandExecutor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor,
): NonStreamingExecutor<ScaffoldIOSProjectParams, ScaffoldIOSProjectResult> {
  return async (params) => {
    try {
      const projectParams = { ...params, platform: 'iOS' };
      const projectPath = await scaffoldProject(projectParams, commandExecutor, fileSystemExecutor);
      const generatedProjectName =
        params.customizeNames === false ? 'MyProject' : params.projectName;
      return createScaffoldDomainResult({
        platform: 'iOS',
        didError: false,
        projectName: params.projectName,
        outputPath: projectPath,
        workspacePath: `${projectPath}/${generatedProjectName}.xcworkspace`,
      });
    } catch (error) {
      return createScaffoldDomainResult({
        platform: 'iOS',
        didError: true,
        error: error instanceof Error ? error.message : String(error),
        projectName: params.projectName,
        outputPath: params.outputPath,
      });
    }
  };
}

/**
 * Logic function for scaffolding iOS projects
 */
export async function scaffold_ios_projectLogic(
  params: ScaffoldIOSProjectParams,
  commandExecutor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executeScaffoldIOSProject = createScaffoldIOSProjectExecutor(
    commandExecutor,
    fileSystemExecutor,
  );
  const result = await executeScaffoldIOSProject(params);

  setScaffoldStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Failed to scaffold iOS project: ${result.error ?? 'Unknown error'}`);
    return;
  }

  const generatedProjectName = params.customizeNames === false ? 'MyProject' : params.projectName;
  ctx.nextStepParams = {
    build_sim: {
      workspacePath:
        result.artifacts.workspacePath ??
        `${result.artifacts.outputPath}/${generatedProjectName}.xcworkspace`,
      scheme: generatedProjectName,
      simulatorName: 'iPhone 17',
    },
    build_run_sim: {
      workspacePath:
        result.artifacts.workspacePath ??
        `${result.artifacts.outputPath}/${generatedProjectName}.xcworkspace`,
      scheme: generatedProjectName,
      simulatorName: 'iPhone 17',
    },
  };
}

/**
 * Scaffold a new iOS or macOS project
 */
async function scaffoldProject(
  params: Record<string, unknown>,
  commandExecutor?: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<string> {
  const projectName = params.projectName as string;
  const outputPath = params.outputPath as string;
  const platform = params.platform as 'iOS' | 'macOS';
  const customizeNames = (params.customizeNames as boolean | undefined) ?? true;

  log('info', `Scaffolding project: ${projectName} (${platform}) at ${outputPath}`);

  // Validate project name
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(projectName)) {
    throw new ValidationError(
      'Project name must start with a letter and contain only letters, numbers, and underscores',
    );
  }

  // Get template path from TemplateManager
  let templatePath;
  try {
    // Use the default command executor if not provided
    commandExecutor ??= getDefaultCommandExecutor();

    templatePath = await TemplateManager.getTemplatePath(
      platform,
      commandExecutor,
      fileSystemExecutor,
    );
  } catch (error) {
    throw new ValidationError(
      `Failed to get template for ${platform}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Use outputPath directly as the destination
  const projectPath = outputPath;

  // Check if the output directory already has Xcode project files
  const xcworkspaceExists = fileSystemExecutor.existsSync(
    join(projectPath, `${customizeNames ? projectName : 'MyProject'}.xcworkspace`),
  );
  const xcodeprojExists = fileSystemExecutor.existsSync(
    join(projectPath, `${customizeNames ? projectName : 'MyProject'}.xcodeproj`),
  );

  if (xcworkspaceExists || xcodeprojExists) {
    throw new ValidationError(`Xcode project files already exist in ${projectPath}`);
  }

  try {
    // Process the template directly into the output path
    await processDirectory(templatePath, projectPath, params, fileSystemExecutor);

    return projectPath;
  } finally {
    // Clean up downloaded template if needed
    await TemplateManager.cleanup(templatePath, fileSystemExecutor);
  }
}

export const schema = ScaffoldiOSProjectSchema.shape;

interface ScaffoldIOSToolContext {
  commandExecutor: CommandExecutor;
  fileSystemExecutor: FileSystemExecutor;
}

export const handler = createTypedToolWithContext(
  ScaffoldiOSProjectSchema,
  (params: ScaffoldIOSProjectParams, ctx: ScaffoldIOSToolContext) =>
    scaffold_ios_projectLogic(params, ctx.commandExecutor, ctx.fileSystemExecutor),
  () => ({
    commandExecutor: getDefaultCommandExecutor(),
    fileSystemExecutor: getDefaultFileSystemExecutor(),
  }),
);
