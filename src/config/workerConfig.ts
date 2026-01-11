// Worker configuration interface
interface WorkerConfig {
  /**
   * Number of workers for simulation
   * -1: Auto (use navigator.hardwareConcurrency)
   * 1+: Manual setting (capped at max available cores)
   */
  WORKER_COUNT: number;
}

// Load worker configuration from JSON file
const loadWorkerConfig = async (): Promise<WorkerConfig> => {
  try {
    const response = await fetch('/config/workerConfig.json');
    if (!response.ok) {
      throw new Error(`Failed to load worker config: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading worker config:', error);
    // Fallback to default values
    return {
      WORKER_COUNT: -1
    };
  }
};

// For synchronous access (will use default until loaded)
let workerConfig: WorkerConfig = {
  WORKER_COUNT: -1
};

// Load config immediately
loadWorkerConfig().then(config => {
  workerConfig = config;
});

/**
 * Get the effective worker count based on config
 * @param fabCount - Number of fabs to process
 * @returns Resolved worker count
 */
export const getWorkerCount = (fabCount?: number): number => {
  const configValue = workerConfig.WORKER_COUNT;
  const maxCores = typeof navigator !== 'undefined'
    ? navigator.hardwareConcurrency || 4
    : 4;

  let resolvedCount: number;

  if (configValue === -1) {
    // Auto: use all available cores
    resolvedCount = maxCores;
  } else if (configValue < 1) {
    // Invalid value, fallback to auto
    resolvedCount = maxCores;
  } else {
    // Manual: cap at max cores
    resolvedCount = Math.min(configValue, maxCores);
  }

  // Also cap at fab count if provided
  if (fabCount !== undefined && fabCount > 0) {
    resolvedCount = Math.min(resolvedCount, fabCount);
  }

  return resolvedCount;
};

/**
 * Get raw config value (for display purposes)
 */
export const getRawWorkerCount = (): number => workerConfig.WORKER_COUNT;
