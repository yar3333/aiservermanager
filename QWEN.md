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
│       │   └── GpuInfo.ts            # GpuInfo interface
│       ├── di/
│       │   ├── types.ts              # InversifyJS injection tokens
│       │   └── container.ts          # Platform-aware DI container
│       ├── routes/
│       │   ├── gpuRoutes.ts          # GET /api/gpus
│       │   └── __tests__/
│       ├── helpers/
│       │   └── ExecTools.ts          # safeExec (platform-aware shell)
│       └── services/
│           ├── gpuService.ts         # Оркестратор: детекторы → дедуп → enrichers → engines
│           ├── detectors/
│           │   ├── gpuDetector.ts    # GpuDetector стратегия
│           │   ├── nvidiaSmiDetector.ts  # nvidia-smi (Win + Linux)
│           │   ├── amdLinuxDetector.ts   # rocm-smi (Linux)
│           │   ├── wmiDetector.ts        # WMI PowerShell (Win)
│           │   └── __tests__/
│           ├── enrichers/
│           │   ├── gpuEnricher.ts    # GpuEnricher стратегия
│           │   ├── lspciEnricher.ts  # lspci brand (Linux)
│           │   ├── vulkanEnricher.ts # vulkaninfo (Linux)
│           │   └── __tests__/
│           └── __tests__/
└── frontend/
    └── src/app/
        ├── app.config.ts             # Zone.js eventCoalescing, HttpClient, Animations
        ├── app.component.ts          # Сигналы, Angular Material
        ├── app.component.html        # @if/@else шаблон, таблица GPU
        ├── app.component.scss        # mat.chips-overrides, vendor colors
        ├── models/gpu.ts             # Gpu интерфейс
        └── services/gpu.service.ts   # HttpClient + RxJS polling (3s)
```

## Backend

### Стек бэка

- **Express 5** + **TypeScript 6** + **InversifyJS 8** (DI)
- Запускается на `PORT=4242`, `HOST=0.0.0.0` (env)
- CORS включён (`cors()` middleware)
- Статические файлы: `backend/public/browser/`, SPA fallback (`index.html`)

### Pipeline детекции GPU

1. **Детекторы** выполняются последовательно. Каждый проверяет `isAvailable()`, затем `detect()`.
2. **Дедупликация** по `vendor:pciBusId` (fallback: `vendor:name`). При коллизии сохраняется запись с большим количеством заполненных полей (score: usage +2, temp +2, vramUsed +1, vulkanName +1, pciBusId +1).
3. **Enrichers** выполняются параллельно (`Promise.all`), мутируют массив `GpuInfo[]` in-place.
4. **Присвоение engine-имён** для llama.cpp: `cuda0`, `rocm0`, `vulkan0` по vendor.

### Platform-aware DI

Контейнер (`di/container.ts`) биндит детекторы в зависимости от `process.platform`:

- **Windows**: `NvidiaSmiDetector` + `WmiDetector`
- **Linux**: `NvidiaSmiDetector` + `AmdLinuxDetector` + `LspciEnricher` + `VulkanEnricher`

Все детекторы биндятся к токену `GPU_DETECTOR` (multi-inject как массив). Enrichers — к `GPU_ENRICHER`.

### `safeExec`

`ExecTools.safeExec()` — обёртка над `child_process.exec` с promisify. `powershell.exe` на Windows, `/bin/sh` на Linux. Таймаут 10 секунд. Никогда не бросает exception, возвращает `{ stdout: "", stderr: err.message }` при ошибке.

### API

| Endpoint    | Method | Описание                                        |
| ----------- | ------ | ----------------------------------------------- |
| `/api/gpus` | GET    | Массив `GpuInfo[]` от `GpuService.getGpuList()` |
| `/health`   | GET    | `{ status: "ok", uptime: number }`              |

### GpuInfo

```ts
interface GpuInfo {
  index: number;
  vendor: string; // "NVIDIA" | "AMD" | "Intel" | "Unknown"
  brand: string; // "MSI" | "ASROCK" | "GIGABYTE" | "RADEON" | производитель платы
  name: string;
  engineCudaName: string; // "cuda0", "cuda1", ...
  engineRocmName: string; // "rocm0", "rocm1", ...
  engineVulkanName: string; // "vulkan0", "vulkan1", ...
  vramTotal: number; // GB
  vramUsed: number; // GB
  usage: number; // GPU utilization %
  temperature: number; // Celsius
  pciBusId: string; // e.g. "01:00.0"
}
```

## Frontend

### Стек фронта

- **Angular 22** (standalone, signals, control flow `@if/@else`)
- **Angular Material 22** (Toolbar, Table, ProgressBar, Card, Chips)
- **RxJS** polling через `timer(0, 3000).pipe(switchMap(fetchGpus))`
- **Zone.js** с `eventCoalescing: true`

### Состояние компонента

```ts
readonly gpus    = signal<Gpu[]>([]);
readonly loading = signal(true);
readonly error   = signal<string | null>(null);
readonly hasGpus = computed(() => this.gpus().length > 0);
```

### Шаблон

Современный Angular control flow (`@if`/`@else`). Цветовая индикация: green <40%, orange <75%, red ≥75% (usage); green <60°C, orange <80°C, red ≥80°C (temp). Vendor chips: NVIDIA = зелёный (#a4f021), AMD = красный (#ffa1a1), другие = синий (#b6e7ff).

Колонки таблицы: `index`, `name`, `engineNames`, `vram`, `usage`, `temperature`, `pciBusId`.

### Гибкое подключение

AppComponent принимает `backendUrl` и `refreshInterval` через `@Input()`, что позволяет монтировать компонент с разными настройками.

## Тесты

### Backend

Jest 30 + ts-jest + supertest. 8 файлов тестов:

- `app.test.ts` — health endpoint + CORS headers
- `gpuRoutes.test.ts` — mock container, 200/empty/500 responses
- `gpuService.test.ts` — sequential detectors, dedup scoring, unavailable detectors
- `exec.test.ts` — safeExec success/failure, platform shell
- `nvidiaSmiDetector.test.ts` — CSV parsing, domain prefix stripping, NaN, VRAM conversion
- `amdLinuxDetector.test.ts` — JSON parsing, multi-GPU, defaults, bytes→GB
- `wmiDetector.test.ts` — NVIDIA/AMD/Intel classification, malformed JSON
- `lspciEnricher.test.ts` — MSI, Gigabyte, Sapphire, ASRock brand detection

`vulkanEnricher.test.ts` отсутствует.

### Frontend

Karma + Jasmine конфигурированы, `.spec.ts` файлы не созданы.

## Команды

| Команда                     | Описание                                           |
| --------------------------- | -------------------------------------------------- |
| `npm run install:all`       | Установить зависимости root + backend + frontend   |
| `npm run dev`               | `ng build --watch` + `ts-node-dev` параллельно     |
| `npm run build`             | `tsc` (backend) + `ng build` → `../backend/public` |
| `cd backend && npm run dev` | Только backend (ts-node-dev --respawn)             |
| `cd backend && npm test`    | Jest --verbose                                     |
| `cd frontend && npm start`  | Только frontend (ng serve --port 4243)             |

В dev-режиме frontend (port 4243) и backend (port 4242) работают на разных портах. CORS на backend разрешает кросс-доменные запросы.

## Паттерны

- **Strategy** — `GpuDetector` / `GpuEnricher` интерфейсы для подключаемых бэкендов
- **Pipeline** — детекторы (seq) → дедуп → enrichers (parallel) → engine names
- **DI** — InversifyJS, platform-aware bindings, multi-inject
- **Signals** — Angular 22 reactive state management
