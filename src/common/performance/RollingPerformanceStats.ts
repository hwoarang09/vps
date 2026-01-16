// common/performance/RollingPerformanceStats.ts
// Rolling window performance statistics with variance and percentiles

export interface PerformanceMetrics {
  // Basic statistics
  mean: number;
  min: number;
  max: number;

  // Stability metrics (GC spike detection)
  variance: number;       // Variance (ms²)
  stdDev: number;         // Standard deviation (ms)
  cv: number;             // Coefficient of variation (stdDev / mean) - normalized variance

  // Extreme value detection (worst case)
  p50: number;            // Median (50th percentile)
  p95: number;            // 95th percentile
  p99: number;            // 99th percentile

  // Metadata
  sampleCount: number;    // Number of samples in this window
}

/**
 * Rolling window performance statistics calculator
 *
 * Tracks performance metrics over a sliding time window (default 5 seconds)
 * to detect GC spikes and performance anomalies.
 *
 * Key insight: Variance/StdDev are better GC spike indicators than mean:
 * - Low stdDev (<5ms) → Stable performance
 * - High stdDev (>20ms) → GC spikes or other anomalies
 *
 * Coefficient of Variation (CV) provides normalized stability metric:
 * - CV < 0.2 → Very stable (within 20% of mean)
 * - CV > 0.5 → Unstable (50%+ variation)
 */
export class RollingPerformanceStats {
  private readonly samples: number[] = [];
  private readonly maxSamples: number;

  /**
   * @param windowSizeMs - Time window in milliseconds (default 5000ms)
   * @param targetFps - Target frame rate (default 60fps)
   */
  constructor(windowSizeMs: number = 5000, targetFps: number = 60) {
    // Calculate max samples based on window size and target FPS
    this.maxSamples = Math.floor(windowSizeMs / (1000 / targetFps));
  }

  /**
   * Add a new performance sample (CPU time in ms)
   */
  addSample(cpuMs: number): void {
    this.samples.push(cpuMs);

    // Keep only the most recent samples within the window
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  /**
   * Calculate all performance metrics for the current window
   */
  getMetrics(): PerformanceMetrics | null {
    const n = this.samples.length;
    if (n === 0) return null;

    // Mean
    const sum = this.samples.reduce((a, b) => a + b, 0);
    const mean = sum / n;

    // Min & Max
    let min = Infinity;
    let max = -Infinity;
    for (const sample of this.samples) {
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }

    // Variance & Standard Deviation
    let varianceSum = 0;
    for (const sample of this.samples) {
      const diff = sample - mean;
      varianceSum += diff * diff;
    }
    const variance = varianceSum / n;
    const stdDev = Math.sqrt(variance);

    // Coefficient of Variation (normalized stability metric)
    const cv = mean > 0 ? stdDev / mean : 0;

    // Percentiles (require sorted array)
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p50 = this.getPercentile(sorted, 0.5);
    const p95 = this.getPercentile(sorted, 0.95);
    const p99 = this.getPercentile(sorted, 0.99);

    return {
      mean,
      min,
      max,
      variance,
      stdDev,
      cv,
      p50,
      p95,
      p99,
      sampleCount: n,
    };
  }

  /**
   * Get percentile value from sorted array
   * @param sorted - Pre-sorted array of samples
   * @param percentile - Percentile to calculate (0.0 to 1.0)
   */
  private getPercentile(sorted: number[], percentile: number): number {
    const n = sorted.length;
    if (n === 0) return 0;
    if (n === 1) return sorted[0];

    const index = Math.floor(n * percentile);
    return sorted[Math.min(index, n - 1)];
  }

  /**
   * Clear all samples
   */
  clear(): void {
    this.samples.length = 0;
  }

  /**
   * Get current sample count
   */
  getSampleCount(): number {
    return this.samples.length;
  }

  /**
   * Check if window is full
   */
  isFull(): boolean {
    return this.samples.length >= this.maxSamples;
  }
}
