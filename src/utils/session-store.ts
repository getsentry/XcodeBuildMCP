import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { DERIVED_DATA_DIR } from './log-paths.ts';
import { log } from './logger.ts';

export type SessionDefaults = {
  projectPath?: string;
  workspacePath?: string;
  scheme?: string;
  configuration?: string;
  simulatorName?: string;
  simulatorId?: string;
  simulatorPlatform?:
    | 'iOS Simulator'
    | 'watchOS Simulator'
    | 'tvOS Simulator'
    | 'visionOS Simulator';
  deviceId?: string;
  useLatestOS?: boolean;
  arch?: 'arm64' | 'x86_64';
  suppressWarnings?: boolean;
  derivedDataPath?: string;
  preferXcodebuild?: boolean;
  platform?: string;
  bundleId?: string;
  env?: Record<string, string>;
};

class SessionStore {
  private globalDefaults: SessionDefaults = {};
  private profiles: Record<string, SessionDefaults> = {};
  private activeProfile: string | null = null;
  private revision = 0;

  private cloneDefaults(defaults: SessionDefaults): SessionDefaults {
    const copy = { ...defaults };
    if (copy.env) {
      copy.env = { ...copy.env };
    }
    return copy;
  }

  private getProfileLabel(profile: string | null): string {
    return profile ?? 'global';
  }

  private clearAllInternal(): void {
    this.globalDefaults = {};
    this.profiles = {};
    this.activeProfile = null;
    this.revision += 1;
    log('info', '[Session] All defaults cleared');
  }

  private clearAllForProfile(profile: string | null): void {
    if (profile === null) {
      this.globalDefaults = {};
      this.revision += 1;
      log('info', '[Session] All defaults cleared (global)');
      return;
    }

    delete this.profiles[profile];
    this.revision += 1;
    log('info', `[Session] All defaults cleared (${profile})`);
  }

  private setDefaultsForResolvedProfile(profile: string | null, defaults: SessionDefaults): void {
    const storedDefaults = this.cloneDefaults(defaults);
    if (profile === null) {
      this.globalDefaults = storedDefaults;
      return;
    }
    this.profiles[profile] = storedDefaults;
  }

  setDefaults(partial: Partial<SessionDefaults>): void {
    this.setDefaultsForProfile(this.activeProfile, partial);
  }

  setDefaultsForProfile(profile: string | null, partial: Partial<SessionDefaults>): void {
    const previous = this.getAllForProfile(profile);
    const next = { ...previous, ...partial };
    this.setDefaultsForResolvedProfile(profile, next);
    this.revision += 1;
    const profileLabel = this.getProfileLabel(profile);
    log('info', `[Session] Defaults updated (${profileLabel}): ${Object.keys(partial).join(', ')}`);
  }

  clear(keys?: (keyof SessionDefaults)[]): void {
    if (keys == null) {
      this.clearForProfile(this.activeProfile);
      return;
    }

    this.clearForProfile(this.activeProfile, keys);
  }

  clearAll(): void {
    this.clearAllInternal();
  }

  clearForProfile(profile: string | null, keys?: (keyof SessionDefaults)[]): void {
    if (keys == null) {
      const wasActiveNamedProfile = profile !== null && profile === this.activeProfile;
      this.clearAllForProfile(profile);
      if (wasActiveNamedProfile) {
        this.activeProfile = null;
        log('info', '[Session] Active defaults profile reset to global');
      }
      return;
    }

    if (keys.length === 0) {
      // No-op when an empty array is provided (e.g., empty UI selection)
      log('info', '[Session] No keys provided to clear; no changes made');
      return;
    }

    const next = this.getAllForProfile(profile);
    for (const k of keys) delete next[k];

    this.setDefaultsForResolvedProfile(profile, next);
    this.revision += 1;
    const profileLabel = this.getProfileLabel(profile);
    log('info', `[Session] Defaults cleared (${profileLabel}): ${keys.join(', ')}`);
  }

  get<K extends keyof SessionDefaults>(key: K): SessionDefaults[K] {
    return this.getAll()[key];
  }

  getAll(): SessionDefaults {
    return this.getAllForProfile(this.activeProfile);
  }

  getAllForProfile(profile: string | null): SessionDefaults {
    const defaults = profile === null ? this.globalDefaults : (this.profiles[profile] ?? {});
    const result = this.cloneDefaults(defaults);

    if (!result.derivedDataPath) {
      const anchor = result.workspacePath ?? result.projectPath;
      if (anchor) {
        const resolved = path.resolve(anchor);
        const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 12);
        const name = path.basename(resolved, path.extname(resolved));
        result.derivedDataPath = path.join(DERIVED_DATA_DIR, `${name}-${hash}`);
      }
    }

    return result;
  }

  listProfiles(): string[] {
    return Object.keys(this.profiles).sort((a, b) => a.localeCompare(b));
  }

  getActiveProfile(): string | null {
    return this.activeProfile;
  }

  setActiveProfile(profile: string | null): void {
    this.activeProfile = profile;
    this.revision += 1;
    if (profile != null && this.profiles[profile] == null) {
      this.profiles[profile] = {};
    }
    log('info', `[Session] Active defaults profile: ${profile ?? 'global'}`);
  }

  getRevision(): number {
    return this.revision;
  }

  setDefaultsIfRevision(partial: Partial<SessionDefaults>, expectedRevision: number): boolean {
    return this.setDefaultsIfRevisionForProfile(this.activeProfile, partial, expectedRevision);
  }

  setDefaultsIfRevisionForProfile(
    profile: string | null,
    partial: Partial<SessionDefaults>,
    expectedRevision: number,
  ): boolean {
    if (this.revision !== expectedRevision) {
      return false;
    }
    this.setDefaultsForProfile(profile, partial);
    return true;
  }
}

export const sessionStore = new SessionStore();
