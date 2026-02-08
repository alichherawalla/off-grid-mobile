/**
 * HardwareService Unit Tests
 *
 * Tests for device info, memory calculations, model recommendations, and formatting.
 * Priority: P0 (Critical) - Device capability detection drives model selection.
 */

import { hardwareService } from '../../../src/services/hardware';
import DeviceInfo from 'react-native-device-info';

const mockedDeviceInfo = DeviceInfo as jest.Mocked<typeof DeviceInfo>;

describe('HardwareService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset cached device info between tests
    (hardwareService as any).cachedDeviceInfo = null;
  });

  // ========================================================================
  // getDeviceInfo
  // ========================================================================
  describe('getDeviceInfo', () => {
    it('returns complete device info object', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Pixel 7');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);

      const info = await hardwareService.getDeviceInfo();

      expect(info.totalMemory).toBe(8 * 1024 * 1024 * 1024);
      expect(info.usedMemory).toBe(4 * 1024 * 1024 * 1024);
      expect(info.availableMemory).toBe(4 * 1024 * 1024 * 1024);
      expect(info.deviceModel).toBe('Pixel 7');
      expect(info.systemName).toBe('Android');
      expect(info.systemVersion).toBe('14');
      expect(info.isEmulator).toBe(false);
    });

    it('calculates availableMemory as total - used', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(12 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(5 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);

      const info = await hardwareService.getDeviceInfo();

      expect(info.availableMemory).toBe(7 * 1024 * 1024 * 1024);
    });

    it('caches result and does not re-fetch', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);

      await hardwareService.getDeviceInfo();
      await hardwareService.getDeviceInfo();

      // Should only be called once due to caching
      expect(mockedDeviceInfo.getTotalMemory).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // refreshMemoryInfo
  // ========================================================================
  describe('refreshMemoryInfo', () => {
    it('updates memory fields in cached info', async () => {
      // First, populate the cache
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();

      // Now refresh with different memory values
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(6 * 1024 * 1024 * 1024);

      const refreshed = await hardwareService.refreshMemoryInfo();

      expect(refreshed.usedMemory).toBe(6 * 1024 * 1024 * 1024);
      expect(refreshed.availableMemory).toBe(2 * 1024 * 1024 * 1024);
    });

    it('creates cache if empty before refreshing', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(3 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);

      const info = await hardwareService.refreshMemoryInfo();

      expect(info).toBeDefined();
      expect(info.totalMemory).toBe(8 * 1024 * 1024 * 1024);
    });

    it('preserves non-memory fields (deviceModel, etc.)', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Galaxy S24');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();

      // Refresh memory
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(5 * 1024 * 1024 * 1024);
      const refreshed = await hardwareService.refreshMemoryInfo();

      expect(refreshed.deviceModel).toBe('Galaxy S24');
    });
  });

  // ========================================================================
  // getTotalMemoryGB
  // ========================================================================
  describe('getTotalMemoryGB', () => {
    it('returns 4 when no cached info', () => {
      expect(hardwareService.getTotalMemoryGB()).toBe(4);
    });

    it('returns correct GB from cached total memory', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();

      expect(hardwareService.getTotalMemoryGB()).toBe(8);
    });

    it('handles 16GB device correctly', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(16 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();

      expect(hardwareService.getTotalMemoryGB()).toBe(16);
    });
  });

  // ========================================================================
  // getAvailableMemoryGB
  // ========================================================================
  describe('getAvailableMemoryGB', () => {
    it('returns 2 when no cached info', () => {
      expect(hardwareService.getAvailableMemoryGB()).toBe(2);
    });

    it('returns correct GB from cached available memory', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(2 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();

      expect(hardwareService.getAvailableMemoryGB()).toBe(6);
    });
  });

  // ========================================================================
  // getModelRecommendation
  // ========================================================================
  describe('getModelRecommendation', () => {
    const setupWithMemory = async (totalGB: number) => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(totalGB * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(2 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();
    };

    it('returns recommendation for 3GB device', async () => {
      await setupWithMemory(3);
      const rec = hardwareService.getModelRecommendation();

      expect(rec.maxParameters).toBe(1.5);
      expect(rec.recommendedQuantization).toBe('Q4_K_M');
    });

    it('returns recommendation for 8GB device', async () => {
      await setupWithMemory(8);
      const rec = hardwareService.getModelRecommendation();

      expect(rec.maxParameters).toBe(8);
    });

    it('returns recommendation for 16GB device', async () => {
      await setupWithMemory(16);
      const rec = hardwareService.getModelRecommendation();

      expect(rec.maxParameters).toBe(30);
    });

    it('adds low-memory warning for devices under 4GB', async () => {
      await setupWithMemory(3.5);
      const rec = hardwareService.getModelRecommendation();

      expect(rec.warning).toContain('limited memory');
    });

    it('adds emulator warning on emulators', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(2 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(true);
      await hardwareService.getDeviceInfo();

      const rec = hardwareService.getModelRecommendation();

      expect(rec.warning).toContain('emulator');
    });
  });

  // ========================================================================
  // canRunModel
  // ========================================================================
  describe('canRunModel', () => {
    const setupWithAvailableMemory = async (totalGB: number, usedGB: number) => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(totalGB * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(usedGB * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();
    };

    it('returns true when sufficient memory available', async () => {
      await setupWithAvailableMemory(16, 4); // 12GB available
      // 7B Q4_K_M = 7 * 4.5 / 8 = ~3.94GB, needs 3.94 * 1.5 = ~5.9GB
      expect(hardwareService.canRunModel(7, 'Q4_K_M')).toBe(true);
    });

    it('returns false when insufficient memory', async () => {
      await setupWithAvailableMemory(4, 3); // 1GB available
      // 7B Q4_K_M needs ~5.9GB
      expect(hardwareService.canRunModel(7, 'Q4_K_M')).toBe(false);
    });

    it('uses correct quantization bits for calculation', async () => {
      await setupWithAvailableMemory(16, 4); // 12GB available
      // 13B Q8_0 = 13 * 8 / 8 = 13GB, needs 13 * 1.5 = 19.5GB
      expect(hardwareService.canRunModel(13, 'Q8_0')).toBe(false);
    });

    it('defaults to Q4_K_M when no quantization specified', async () => {
      await setupWithAvailableMemory(16, 4); // 12GB available
      // 7B Q4_K_M default = 7 * 4.5 / 8 ≈ 3.94GB, * 1.5 ≈ 5.9GB → true
      expect(hardwareService.canRunModel(7)).toBe(true);
    });
  });

  // ========================================================================
  // estimateModelMemoryGB
  // ========================================================================
  describe('estimateModelMemoryGB', () => {
    it('estimates 7B Q4_K_M correctly', () => {
      // 7 * 4.5 / 8 = 3.9375
      expect(hardwareService.estimateModelMemoryGB(7, 'Q4_K_M')).toBeCloseTo(3.9375);
    });

    it('estimates 13B Q8_0 correctly', () => {
      // 13 * 8 / 8 = 13
      expect(hardwareService.estimateModelMemoryGB(13, 'Q8_0')).toBe(13);
    });

    it('estimates 3B F16 correctly', () => {
      // 3 * 16 / 8 = 6
      expect(hardwareService.estimateModelMemoryGB(3, 'F16')).toBe(6);
    });

    it('uses 2.625 bits for Q2_K', () => {
      // 7 * 2.625 / 8 = 2.296875
      expect(hardwareService.estimateModelMemoryGB(7, 'Q2_K')).toBeCloseTo(2.296875);
    });

    it('returns default 4.5 bits for unknown quantization', () => {
      // 7 * 4.5 / 8 = 3.9375
      expect(hardwareService.estimateModelMemoryGB(7, 'UNKNOWN')).toBeCloseTo(3.9375);
    });

    it('handles case-insensitive quantization strings', () => {
      // q4_k_m should match Q4_K_M
      expect(hardwareService.estimateModelMemoryGB(7, 'q4_k_m')).toBeCloseTo(3.9375);
    });
  });

  // ========================================================================
  // formatBytes
  // ========================================================================
  describe('formatBytes', () => {
    it('formats 0 as "0 B"', () => {
      expect(hardwareService.formatBytes(0)).toBe('0 B');
    });

    it('formats bytes correctly', () => {
      expect(hardwareService.formatBytes(500)).toBe('500.00 B');
    });

    it('formats kilobytes correctly', () => {
      expect(hardwareService.formatBytes(2048)).toBe('2.00 KB');
    });

    it('formats megabytes correctly', () => {
      expect(hardwareService.formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
    });

    it('formats gigabytes correctly', () => {
      expect(hardwareService.formatBytes(4 * 1024 * 1024 * 1024)).toBe('4.00 GB');
    });
  });

  // ========================================================================
  // getModelTotalSize
  // ========================================================================
  describe('getModelTotalSize', () => {
    it('returns fileSize for text-only model', () => {
      expect(hardwareService.getModelTotalSize({ fileSize: 4000000000 })).toBe(4000000000);
    });

    it('combines fileSize and mmProjFileSize for vision model', () => {
      expect(hardwareService.getModelTotalSize({
        fileSize: 4000000000,
        mmProjFileSize: 500000000,
      })).toBe(4500000000);
    });

    it('returns 0 when no size fields are present', () => {
      expect(hardwareService.getModelTotalSize({})).toBe(0);
    });

    it('uses size field as fallback for fileSize', () => {
      expect(hardwareService.getModelTotalSize({ size: 3000000000 })).toBe(3000000000);
    });
  });

  // ========================================================================
  // getDeviceTier
  // ========================================================================
  describe('getDeviceTier', () => {
    const setupWithTotalMemory = async (totalGB: number) => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(totalGB * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(2 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();
    };

    it('returns "low" for under 4GB', async () => {
      await setupWithTotalMemory(3);
      expect(hardwareService.getDeviceTier()).toBe('low');
    });

    it('returns "medium" for 4-6GB', async () => {
      await setupWithTotalMemory(5);
      expect(hardwareService.getDeviceTier()).toBe('medium');
    });

    it('returns "high" for 6-8GB', async () => {
      await setupWithTotalMemory(7);
      expect(hardwareService.getDeviceTier()).toBe('high');
    });

    it('returns "flagship" for 8GB+', async () => {
      await setupWithTotalMemory(12);
      expect(hardwareService.getDeviceTier()).toBe('flagship');
    });
  });
});
