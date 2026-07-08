import "reflect-metadata";
import { Container } from "inversify";
import { GPU_SERVICE, GPU_DETECTOR, GPU_ENRICHER, GPU_USAGE_PROBE } from "./types";
import { GpuService } from "../services/gpuService";
import { GpuDetector } from "../services/detectors/gpuDetector";
import { NvidiaSmiDetector } from "../services/detectors/nvidiaSmiDetector";
import { AmdLinuxDetector } from "../services/detectors/amdLinuxDetector";
import { WmiDetector } from "../services/detectors/wmiDetector";
import { GpuEnricher } from "../services/enrichers/gpuEnricher";
import { LspciEnricher } from "../services/enrichers/lspciEnricher";
import { VulkanEnricher } from "../services/enrichers/vulkanEnricher";
import { GpuUsageProbe } from "../services/probes/gpuUsageProbe";
import { NvidiaSmiUsageProbe } from "../services/probes/nvidiaSmiUsageProbe";
import { AmdLinuxUsageProbe } from "../services/probes/amdLinuxUsageProbe";

const isWindows = process.platform === "win32";

export function createContainer(): Container {
  const container = new Container();

  // GpuService — singleton for the lifetime of the app
  container.bind<GpuService>(GPU_SERVICE).to(GpuService).inSingletonScope();

  // Detectors — static GPU info (run once at bootstrap)
  container.bind<GpuDetector>(GPU_DETECTOR).to(NvidiaSmiDetector);
  if (isWindows) {
    container.bind<GpuDetector>(GPU_DETECTOR).to(WmiDetector);
  } else {
    container.bind<GpuDetector>(GPU_DETECTOR).to(AmdLinuxDetector);
  }

  // Enrichers — Linux only, enrich static info
  if (!isWindows) {
    container.bind<GpuEnricher>(GPU_ENRICHER).to(LspciEnricher);
    container.bind<GpuEnricher>(GPU_ENRICHER).to(VulkanEnricher);
  }

  // Usage probes — dynamic metrics (usage, temperature, vramUsed)
  container.bind<GpuUsageProbe>(GPU_USAGE_PROBE).to(NvidiaSmiUsageProbe);
  if (!isWindows) {
    container.bind<GpuUsageProbe>(GPU_USAGE_PROBE).to(AmdLinuxUsageProbe);
  }

  return container;
}
