import { describe, it, expect } from 'vitest';

import * as testMacos from '../test_macos.ts';
import * as buildMacos from '../build_macos.ts';
import * as buildRunMacos from '../build_run_macos.ts';
import * as getMacAppPath from '../get_mac_app_path.ts';
import * as launchMacApp from '../launch_mac_app.ts';
import * as stopMacApp from '../stop_mac_app.ts';

describe('macos tool module exports', () => {
  describe('test_macos exports', () => {
    it('should export schema and handler', () => {
      expect(typeof testMacos.handler).toBe('function');
      expect(testMacos.schema).toBeDefined();
      expect(typeof testMacos.schema).toBe('object');
    });
  });

  describe('build_macos exports', () => {
    it('should export schema and handler', () => {
      expect(typeof buildMacos.handler).toBe('function');
      expect(buildMacos.schema).toBeDefined();
      expect(typeof buildMacos.schema).toBe('object');
    });
  });

  describe('build_run_macos exports', () => {
    it('should export schema and handler', () => {
      expect(typeof buildRunMacos.handler).toBe('function');
      expect(buildRunMacos.schema).toBeDefined();
      expect(typeof buildRunMacos.schema).toBe('object');
    });
  });

  describe('get_mac_app_path exports', () => {
    it('should export schema and handler', () => {
      expect(typeof getMacAppPath.handler).toBe('function');
      expect(getMacAppPath.schema).toBeDefined();
      expect(typeof getMacAppPath.schema).toBe('object');
    });
  });

  describe('launch_mac_app exports', () => {
    it('should export schema and handler', () => {
      expect(typeof launchMacApp.handler).toBe('function');
      expect(launchMacApp.schema).toBeDefined();
      expect(typeof launchMacApp.schema).toBe('object');
    });
  });

  describe('stop_mac_app exports', () => {
    it('should export schema and handler', () => {
      expect(typeof stopMacApp.handler).toBe('function');
      expect(stopMacApp.schema).toBeDefined();
      expect(typeof stopMacApp.schema).toBe('object');
    });
  });

  describe('All tool modules validation', () => {
    const toolModules = [
      { module: testMacos, name: 'test_macos' },
      { module: buildMacos, name: 'build_macos' },
      { module: buildRunMacos, name: 'build_run_macos' },
      { module: getMacAppPath, name: 'get_mac_app_path' },
      { module: launchMacApp, name: 'launch_mac_app' },
      { module: stopMacApp, name: 'stop_mac_app' },
    ];

    it('should have all required exports', () => {
      toolModules.forEach(({ module, name }) => {
        expect(module).toHaveProperty('schema');
        expect(module).toHaveProperty('handler');
      });
    });

    it('should have callable handlers', () => {
      toolModules.forEach(({ module }) => {
        expect(typeof module.handler).toBe('function');
      });
    });

    it('should have valid schemas', () => {
      toolModules.forEach(({ module }) => {
        expect(module.schema).toBeDefined();
        expect(typeof module.schema).toBe('object');
      });
    });
  });
});
