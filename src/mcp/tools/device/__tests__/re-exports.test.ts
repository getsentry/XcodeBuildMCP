import { describe, it, expect } from 'vitest';

import * as launchAppDevice from '../launch_app_device.ts';
import * as stopAppDevice from '../stop_app_device.ts';
import * as listDevices from '../list_devices.ts';
import * as installAppDevice from '../install_app_device.ts';
import * as buildRunDevice from '../build_run_device.ts';

describe('device tool named exports', () => {
  describe('launch_app_device exports', () => {
    it('should export schema and handler', () => {
      expect(launchAppDevice.schema).toBeDefined();
      expect(typeof launchAppDevice.handler).toBe('function');
    });
  });

  describe('stop_app_device exports', () => {
    it('should export schema and handler', () => {
      expect(stopAppDevice.schema).toBeDefined();
      expect(typeof stopAppDevice.handler).toBe('function');
    });
  });

  describe('list_devices exports', () => {
    it('should export schema and handler', () => {
      expect(listDevices.schema).toBeDefined();
      expect(typeof listDevices.handler).toBe('function');
    });
  });

  describe('install_app_device exports', () => {
    it('should export schema and handler', () => {
      expect(installAppDevice.schema).toBeDefined();
      expect(typeof installAppDevice.handler).toBe('function');
    });
  });

  describe('build_run_device exports', () => {
    it('should export schema and handler', () => {
      expect(buildRunDevice.schema).toBeDefined();
      expect(typeof buildRunDevice.handler).toBe('function');
    });
  });

  describe('All exports validation', () => {
    const modules = [
      { mod: launchAppDevice, name: 'launch_app_device' },
      { mod: stopAppDevice, name: 'stop_app_device' },
      { mod: listDevices, name: 'list_devices' },
      { mod: installAppDevice, name: 'install_app_device' },
      { mod: buildRunDevice, name: 'build_run_device' },
    ];

    it('should have callable handlers', () => {
      modules.forEach(({ mod }) => {
        expect(typeof mod.handler).toBe('function');
        expect(mod.handler.length).toBeGreaterThanOrEqual(0);
      });
    });

    it('should have valid schemas', () => {
      modules.forEach(({ mod }) => {
        expect(mod.schema).toBeDefined();
        expect(typeof mod.schema).toBe('object');
      });
    });
  });
});
