import DeviceInfo from 'react-native-device-info';
import { NativeModules, Platform } from 'react-native';
import { DeviceInfo as DeviceInfoType, ModelRecommendation } from '../types';
import { MODEL_RECOMMENDATIONS, RECOMMENDED_MODELS } from '../constants';

class HardwareService {
  private cachedDeviceInfo: DeviceInfoType | null = null;

  async getDeviceInfo(): Promise<DeviceInfoType> {
    if (this.cachedDeviceInfo) {
      return this.cachedDeviceInfo;
    }

    const [
      totalMemory,
      usedMemory,
      deviceModel,
      systemName,
      systemVersion,
      isEmulator,
    ] = await Promise.all([
      DeviceInfo.getTotalMemory(),
      DeviceInfo.getUsedMemory(),
      DeviceInfo.getModel(),
      DeviceInfo.getSystemName(),
      DeviceInfo.getSystemVersion(),
      DeviceInfo.isEmulator(),
    ]);

    this.cachedDeviceInfo = {
      totalMemory,
      usedMemory,
      availableMemory: totalMemory - usedMemory,
      deviceModel,
      systemName,
      systemVersion,
      isEmulator,
    };

    return this.cachedDeviceInfo;
  }

  async refreshMemoryInfo(): Promise<DeviceInfoType> {
    // Force fresh fetch of all memory info
    const [totalMemory, usedMemory] = await Promise.all([
      DeviceInfo.getTotalMemory(),
      DeviceInfo.getUsedMemory(),
    ]);

    if (!this.cachedDeviceInfo) {
      await this.getDeviceInfo();
    }

    if (this.cachedDeviceInfo) {
      this.cachedDeviceInfo.totalMemory = totalMemory;
      this.cachedDeviceInfo.usedMemory = usedMemory;
      this.cachedDeviceInfo.availableMemory = totalMemory - usedMemory;
    }

    return this.cachedDeviceInfo!;
  }

  /**
   * Get app-specific memory usage (more accurate for tracking model memory)
   * Note: This is system memory, native allocations may not be fully reflected
   */
  async getAppMemoryUsage(): Promise<{ used: number; available: number; total: number }> {
    const total = await DeviceInfo.getTotalMemory();
    const used = await DeviceInfo.getUsedMemory();
    return {
      used,
      available: total - used,
      total,
    };
  }

  getTotalMemoryGB(): number {
    if (!this.cachedDeviceInfo) {
      return 4; // Default assumption
    }
    return this.cachedDeviceInfo.totalMemory / (1024 * 1024 * 1024);
  }

  getAvailableMemoryGB(): number {
    if (!this.cachedDeviceInfo) {
      return 2; // Default assumption
    }
    return this.cachedDeviceInfo.availableMemory / (1024 * 1024 * 1024);
  }

  getModelRecommendation(): ModelRecommendation {
    const totalRamGB = this.getTotalMemoryGB();

    // Find the appropriate recommendation tier
    const tier = MODEL_RECOMMENDATIONS.memoryToParams.find(
      t => totalRamGB >= t.minRam && totalRamGB < t.maxRam
    ) || MODEL_RECOMMENDATIONS.memoryToParams[0];

    // Filter recommended models based on device capability
    const compatibleModels = RECOMMENDED_MODELS
      .filter(m => m.minRam <= totalRamGB)
      .map(m => m.id);

    let warning: string | undefined;
    if (totalRamGB < 4) {
      warning = 'Your device has limited memory. Only the smallest models will work well.';
    } else if (this.cachedDeviceInfo?.isEmulator) {
      warning = 'Running in emulator. Performance may be significantly slower.';
    }

    return {
      maxParameters: tier.maxParams,
      recommendedQuantization: tier.quantization,
      recommendedModels: compatibleModels,
      warning,
    };
  }

  canRunModel(parametersBillions: number, quantization: string = 'Q4_K_M'): boolean {
    const availableMemoryGB = this.getAvailableMemoryGB();

    // Estimate model memory requirement
    // Q4_K_M uses ~0.5 bytes per parameter + overhead
    const bitsPerWeight = this.getQuantizationBits(quantization);
    const modelSizeGB = (parametersBillions * bitsPerWeight) / 8;

    // Need at least 1.5x the model size for safe operation
    const requiredMemory = modelSizeGB * 1.5;

    return availableMemoryGB >= requiredMemory;
  }

  estimateModelMemoryGB(parametersBillions: number, quantization: string = 'Q4_K_M'): number {
    const bitsPerWeight = this.getQuantizationBits(quantization);
    return (parametersBillions * bitsPerWeight) / 8;
  }

  private getQuantizationBits(quantization: string): number {
    const bits: Record<string, number> = {
      'Q2_K': 2.625,
      'Q3_K_S': 3.4375,
      'Q3_K_M': 3.4375,
      'Q4_0': 4,
      'Q4_K_S': 4.5,
      'Q4_K_M': 4.5,
      'Q5_K_S': 5.5,
      'Q5_K_M': 5.5,
      'Q6_K': 6.5,
      'Q8_0': 8,
      'F16': 16,
    };

    // Try to match quantization string
    for (const [key, value] of Object.entries(bits)) {
      if (quantization.toUpperCase().includes(key)) {
        return value;
      }
    }

    return 4.5; // Default to Q4_K_M
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }

  /**
   * Get combined model size including mmproj for vision models.
   * Use this everywhere model size is displayed for consistency.
   */
  getModelTotalSize(model: { fileSize?: number; size?: number; mmProjFileSize?: number }): number {
    const mainSize = model.fileSize || model.size || 0;
    const mmProjSize = model.mmProjFileSize || 0;
    return mainSize + mmProjSize;
  }

  /**
   * Format combined model size including mmproj.
   * Use this everywhere model size is displayed for consistency.
   */
  formatModelSize(model: { fileSize?: number; size?: number; mmProjFileSize?: number }): string {
    return this.formatBytes(this.getModelTotalSize(model));
  }

  /**
   * Get estimated RAM usage for a model (combined size * overhead multiplier).
   */
  estimateModelRam(model: { fileSize?: number; size?: number; mmProjFileSize?: number }, multiplier: number = 1.5): number {
    return this.getModelTotalSize(model) * multiplier;
  }

  /**
   * Format estimated RAM usage for a model.
   */
  formatModelRam(model: { fileSize?: number; size?: number; mmProjFileSize?: number }, multiplier: number = 1.5): string {
    const ramBytes = this.estimateModelRam(model, multiplier);
    const ramGB = ramBytes / (1024 * 1024 * 1024);
    return `~${ramGB.toFixed(1)} GB`;
  }

  getDeviceTier(): 'low' | 'medium' | 'high' | 'flagship' {
    const ramGB = this.getTotalMemoryGB();

    if (ramGB < 4) return 'low';
    if (ramGB < 6) return 'medium';
    if (ramGB < 8) return 'high';
    return 'flagship';
  }
}

export const hardwareService = new HardwareService();
