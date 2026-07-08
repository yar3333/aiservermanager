# AI Server Manager

Мониторинг GPU-серверов в реальном времени. Отображает утилизацию, VRAM, температуру и PCI-адреса для NVIDIA и AMD GPU через веб-дашборд.

## Архитектура

Monorepo с двумя пакетами: **backend** (Node.js + Express + InversifyJS) и **frontend** (Angular 22 standalone).

```text
aiservermanager/
├── backend/
│   └── src/
│       ├── index.ts                  # Express entry, port 4242, SPA fallback
│       ├── models/
│       │   └── GpuInfo.ts            # GpuInfo (static), GpuUsage, GpuState
│       ├── di/
│       │   ├── types.ts              # InversifyJS injection tokens
│       │   └── container.ts          # Platform-aware DI container
│       ├── routes/
│       │   ├── gpuRoutes.ts          # GET / /usage /state
│       │   └── __tests__/
│       ├── helpers/
│       │   └── ExecTools.ts          # safeExec (platform-aware shell)
│       └── services/
│           ├── gpuService.ts         # Bootstrap (once) + usage polling (every req)
│           ├── helpers/
│           │   ├── gpuDedup.ts       # deduplicateGpus() + staticScore()
│           │   └── gpuEngineNames.ts # assignEngineNames()
│           ├── detectors/            # Static GPU info (run once)
│           │   ├── gpuDetector.ts    # GpuDetector стратегия
│           │   ├── nvidiaSmiDetector.ts  # nvidia-smi (Win + Linux)
│           │   ├── amdLinuxDetector.ts   # rocm-smi (Linux)
│           │   ├── wmiDetector.ts        # WMI PowerShell (Win)
│           │   └── __tests__/
│           ├── enrichers/            # Enrich static info
│           │   ├── gpuEnricher.ts    # GpuEnricher стратегия
│           │   ├── lspciEnricher.ts  # lspci brand (Linux)
│           │   ├── vulkanEnricher.ts # vulkaninfo (Linux)
│           │   └── __tests__/
│           ├── probes/               # Dynamic metrics polling
│           │   ├── gpuUsageProbe.ts      # GpuUsageProbe стратегия
│           │   ├── nvidiaSmiUsageProbe.ts
│           │   └── amdLinuxUsageProbe.ts
│           └── __tests__/
└── frontend/
    └── src/app/
        ├── app.config.ts             # Zone.js eventCoalescing, HttpClient, Animations
        ├── app.component.ts          # Сигналы, 2-поточный polling
        ├── app.component.html        # @if/@else шаблон, таблица GPU
        ├── app.component.scss        # mat.chips-overrides, vendor colors
        ├── models/gpu.ts             # Gpu, GpuUsage, GpuState
        └── services/gpu.service.ts   # fetchGpus() + watchUsage()
```

## Backend

### Стек бэка

- **Express 5** + **TypeScript 6** + **InversifyJS 8** (DI)
- Запускается на `PORT=4242`, `HOST=0.0.0.0` (env)
- CORS включён (`cors()` middleware)
- Статические файлы: `backend/public/browser/`, SPA fallback (`index.html`)

### Двухфазная модель данных

**Bootstrap (один раз)**: детекторы → дедуп → enrichers → engine names → кэш `GpuInfo[]`.

**Polling (каждый запрос)**: usage probes → merge по `pciBusId` → `GpuState[]`.

Детекторы собирают только статические поля (`name`, `vramTotal`, `pciBusId`). Usage probes опрашивают только динамические (`usage`, `temperature`, `vramUsed`).

### Bootstrap pipeline

1. **Детекторы** выполняются последовательно. Каждый проверяет `isAvailable()`, затем `detect()`.
2. **Дедупликация** по `vendor:pciBusId` (fallback: `vendor:name`). При коллизии сохраняется запись с большим score: `pciBusId` +2, `vramTotal` +1, `engineVulkanName` +1, brand ≠ vendor +1.
3. **Enrichers** выполняются параллельно (`Promise.all`), мутируют `GpuInfo[]` in-place.
4. **Присвоение engine-имён** для llama.cpp: `cuda0`, `rocm0`, `vulkan0` по vendor.

### Usage probes

Лёгкие запросы только динамических метрик. Биндятся к `GPU_USAGE_PROBE`:

- **Windows**: `NvidiaSmiUsageProbe` — `nvidia-smi` (index, usage, temp, vramUsed, pci)
- **Linux**: `NvidiaSmiUsageProbe` + `AmdLinuxUsageProbe` — `rocm-smi` (temp, usage, vramUsed)

### Platform-aware DI

Контейнер (`di/container.ts`) биндит компоненты в зависимости от `process.platform`:

| Токен             | Windows             | Linux                                    |
| ----------------- | ------------------- | ---------------------------------------- |
| `GPU_DETECTOR`    | NvidiaSmi + Wmi     | NvidiaSmi + AmdLinux                     |
| `GPU_ENRICHER`    | —                   | Lspci + Vulkan                           |
| `GPU_USAGE_PROBE` | NvidiaSmiUsageProbe | NvidiaSmiUsageProbe + AmdLinuxUsageProbe |

### `ExecTools.safeExec`

`ExecTools.safeExec()` — обёртка над `child_process.exec` с promisify. `powershell.exe` на Windows, `/bin/sh` на Linux. Таймаут 10 секунд. Никогда не бросает exception, возвращает `{ stdout: "", stderr: err.message }` при ошибке.

### API

| Endpoint          | Method | Описание                                                       |
| ----------------- | ------ | -------------------------------------------------------------- |
| `/api/gpus`       | GET    | `GpuInfo[]` — статическая информация (1 раз при инициализации) |
| `/api/gpus/usage` | GET    | `GpuUsage[]` — динамические метрики (поллинг каждые 3с)        |
| `/health`         | GET    | `{ status: "ok", uptime: number }`                             |

### Модели

```ts
// Статические — не меняются
interface GpuInfo {
  index: number;
  vendor: string; // "NVIDIA" | "AMD" | "Intel" | "Unknown"
  brand: string; // "MSI" | "ASROCK" | "GIGABYTE" | производитель платы
  name: string;
  engineCudaName: string; // "cuda0", "cuda1", ...
  engineRocmName: string; // "rocm0", "rocm1", ...
  engineVulkanName: string; // "vulkan0", "vulkan1", ...
  vramTotal: number; // GB
  pciBusId: string; // e.g. "01:00.0"
}

// Динамические — меняются каждый poll
interface GpuUsage {
  key: string; // ключ для match (pciBusId)
  usage: number; // GPU utilization %
  temperature: number; // Celsius
  vramUsed: number; // GB
}
```

Фронтенд мерджит `GpuInfo` + `GpuUsage` на клиенте (`GpuWithUsage`).

### Тесты backend

Jest 30 + ts-jest + supertest. 8 файлов тестов, 59 тестов.

## Frontend

### Стек фронта

- **Angular 22** (standalone, signals, control flow `@if/@else`)
- **Angular Material 22** (Toolbar, Table, ProgressBar, Card, Chips)
- **RxJS** — два независимых стрима: `fetchGpus()` (1 раз) + `watchUsage()` (poll 3s)
- **Zone.js** с `eventCoalescing: true`

### Состояние компонента

```ts
readonly gpus    = signal<GpuWithUsage[]>([]); // static + usage, merged on client
readonly loading = signal(true);
readonly error   = signal<string | null>(null);
readonly hasGpus = computed(() => this.gpus().length > 0);
```

Компонент загружает статическую информацию один раз, затем подписывается на `watchUsage()` и мерджит usage по `pciBusId` в кэшированные GPU-записи.

## Команды

| Команда                     | Описание                                           |
| --------------------------- | -------------------------------------------------- |
| `npm run install:all`       | Установить зависимости root + backend + frontend   |
| `npm run dev`               | `ng build --watch` + `ts-node-dev` параллельно     |
| `npm run build`             | `tsc` (backend) + `ng build` → `../backend/public` |
| `cd backend && npm run dev` | Только backend (ts-node-dev --respawn)             |
| `cd backend && npm test`    | Jest --verbose                                     |

## Паттерны

- **Strategy** — `GpuDetector` / `GpuEnricher` / `GpuUsageProbe` интерфейсы
- **Two-phase** — bootstrap (static, cached) + polling (dynamic, per-request)
- **DI** — InversifyJS, platform-aware bindings, multi-inject
- **Signals** — Angular 22 reactive state management
