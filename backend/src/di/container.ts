import "reflect-metadata";
import { Container } from "inversify";
import {
  AUTH_SERVICE,
  GPU_SERVICE,
  GPU_DETECTOR,
  GPU_ENRICHER,
  GPU_USAGE_PROBE,
  SERVICE_MANAGER,
  SERVICE_CONTROLLER,
  SERVICE_CONFIG_CONTROLLER,
  MANAGED_SERVICES_CONTROLLER,
} from "./types";
import { AuthService } from "../services/authService";
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
import { ServiceManager } from "../services/serviceManager";
import { ServiceController } from "../services/serviceController";
import { SystemctlController } from "../services/controllers/systemctlController";
import { WindowsServiceController } from "../services/controllers/windowsServiceController";
import { ServiceConfigController } from "../services/serviceConfigController";
import { ManagedServicesController } from "../services/managedServicesController";

const isWindows = process.platform === "win32";

export function createContainer(): Container {
  const container = new Container();

  // Auth service — JWT generation + password verification
  container.bind<AuthService>(AUTH_SERVICE).to(AuthService).inSingletonScope();

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

  // Service controllers — platform-aware strategies
  container.bind<ServiceController>(SERVICE_CONTROLLER).to(SystemctlController);
  container.bind<ServiceController>(SERVICE_CONTROLLER).to(WindowsServiceController);

  // Service manager — orchestrates llama.cpp / ComfyUI (multi-injects controllers)
  container.bind<ServiceManager>(SERVICE_MANAGER).to(ServiceManager).inSingletonScope();

  // Service config controller — CRUD for user-created llama service configs
  container.bind<ServiceConfigController>(SERVICE_CONFIG_CONTROLLER).to(ServiceConfigController).inSingletonScope();

  // Managed services controller — discover available services + manage user selection
  container
    .bind<ManagedServicesController>(MANAGED_SERVICES_CONTROLLER)
    .to(ManagedServicesController)
    .inSingletonScope();

  return container;
}
