# AI Server Manager

Мониторинг GPU-серверов и управление AI-сервисами через веб-дашборд.

Два типа сервисов:

- **Custom** — полный контроль: имя, команда, CLI flags. Конфиг в `~/.config/aiservermanager/services/<name>.conf`
- **Managed** — выбор из установленных systemd-сервисов. Только start/stop/enable/disable

## Установка

На linux нужно поставить пакет PAM:

```bash
sudo apt install libpam0g-dev
```

## Архитектура

Monorepo с двумя пакетами: **backend** (Node.js + Express + InversifyJS) и **frontend** (Angular 22 standalone).

```text
aiservermanager/
├── backend/
│   └── src/
│       ├── index.ts                  # Express entry, port 4243, SPA fallback
│       ├── files/                    # Raw files copied to dist/files/ at build (for ts-node-dev)
│       │   └── wmiGpuQuery.ps1       # PS1 script: WMI + HKLM registry → pciBusId (BB:DD.F)
│       ├── models/
│       │   ├── GpuInfo.ts            # GpuInfo (static), GpuUsage, GpuState
│       │   ├── ServiceStatus.ts      # ServiceStatus, ServiceAction
│       │   └── ServiceConfig.ts      # ServiceConfig (user-created llama configs)
│       ├── di/
│       │   ├── types.ts              # InversifyJS injection tokens
│       │   └── container.ts          # Platform-aware DI container
│       ├── routes/
│       │   ├── gpuRoutes.ts          # GET / /usage /state
│       │   ├── serviceRoutes.ts      # Services API + managed services CRUD
│       │   └── __tests__/
│       ├── helpers/
│       │   └── ExecTools.ts          # safeExec (platform-aware shell), safeExecPs1 (.ps1 files)
│       └── services/
│           ├── gpuService.ts         # Bootstrap (once) + usage polling (every req)
│           ├── serviceController.ts  # ServiceController стратегия
│           ├── serviceManager.ts     # Resolves managed + llama services, dispatches actions
│           ├── serviceConfigController.ts # CRUD for user-created llama configs
│           ├── managedServicesManager.ts  # Persist user-selected service names (JSON file)
│           ├── managedServicesController.ts # Discover available + manage selection
│           ├── configManager.ts      # File I/O for ~/.config/aiservermanager/services/*.conf
│           ├── controllers/          # Platform-aware service control
│           │   ├── systemctlController.ts    # systemctl (Linux)
│           │   └── windowsServiceController.ts # SC cmdlet (Windows)
│           ├── helpers/
│           │   ├── gpuDedup.ts       # deduplicateGpus() + staticScore()
│           │   └── gpuEngineNames.ts # assignEngineNames()
│           ├── detectors/            # Static GPU info (run once)
│           │   ├── gpuDetector.ts    # GpuDetector стратегия
│           │   ├── nvidiaSmiDetector.ts  # nvidia-smi (Win + Linux)
│           │   ├── amdLinuxDetector.ts   # rocm-smi (Linux)
│           │   ├── wmiDetector.ts        # WMI PowerShell (Win) + registry for pciBusId
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
    └── src/
        ├── app/
        │   ├── app.config.ts         # Zone.js eventCoalescing, HttpClient, Animations
        │   ├── app.component.ts      # Сигналы, 2-поточный polling GPU
        │   ├── app.component.html    # @if/@else шаблон, compose layout
        │   └── app.component.scss    # container layout styles
        ├── components/
        │   ├── gpu-table/            # Таблица GPU (вынесен из AppComponent)
        │   └── services/             # Карточки управления сервисами
        │       ├── service-dialog/   # Диалог создания/редактирования llama-конфигов
        │       └── managed-services-dialog/ # Диалог выбора системных сервисов
        ├── models/
        │   ├── gpu.ts                # Gpu, GpuUsage, GpuState
        │   └── service.ts            # ServiceStatus, ServiceAction, ServiceConfig
        └── services/
            ├── gpu.service.ts        # fetchGpus() + watchUsage()
            └── service.service.ts    # Services API + managed services
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

| Токен                | Windows                  | Linux                                          |
| -------------------- | ------------------------ | ---------------------------------------------- |
| `GPU_DETECTOR`       | NvidiaSmi + Wmi          | NvidiaSmi + AmdLinux                           |
| `GPU_ENRICHER`       | —                        | Lspci + Vulkan                                 |
| `GPU_USAGE_PROBE`    | NvidiaSmiUsageProbe      | NvidiaSmiUsageProbe + AmdLinuxUsageProbe       |
| `SERVICE_CONTROLLER` | WindowsServiceController | SystemctlController + WindowsServiceController |

Все контроллеры сервиса биндятся всегда (multi-inject). `ServiceManager` выбирает активный через `isAvailable()` — на Windows работает `WindowsServiceController`, на Linux — `SystemctlController`.

**Linux** (`systemctl`):

- `systemctl is-active <name>` — статус запущенности
- `systemctl is-enabled <name>` — автозагрузка
- `systemctl show --property=MainPID --value` — PID
- `systemctl start|stop|enable|disable <name>` — управление
- `systemctl list-unit-files --type=service` — discover всех сервисов (исключает custom)

**Windows** (`sc.exe` + PowerShell fallback `Get-Service`):

- `sc.exe queryex <name>` — STATE, START_TYPE, PID
- `sc.exe start|stop <name>` — запуск/остановка
- `sc.exe config <name> start= auto|disabled` — включение/отключение
- `Get-Service` — discover всех Windows-сервисов

### `ExecTools`

`safeExec()` — обёртка над `child_process.exec` с promisify. `powershell.exe` на Windows, `/bin/sh` на Linux. Таймаут 10 секунд.

`safeExecPs1(scriptPath)` — `child_process.spawn` для выполнения `.ps1` файлов. Избегает проблем с экранированием при передаче сложных скриптов через `exec`. Оба метода никогда не бросают exception, возвращают `{ stdout: "", stderr: err.message }` при ошибке.

### API

| Endpoint                          | Method | Описание                                                         |
| --------------------------------- | ------ | ---------------------------------------------------------------- |
| `/api/gpus`                       | GET    | `GpuInfo[]` — статическая информация (1 раз при инициализации)   |
| `/api/gpus/usage`                 | GET    | `GpuUsage[]` — динамические метрики (поллинг каждые 3с)          |
| `/api/services`                   | GET    | `ServiceStatus[]` — статус управляемых сервисов                  |
| `/api/services/control`           | POST   | `{ name, action }` → `ServiceStatus` — start/stop/enable/disable |
| `/api/services/config`            | GET    | `ServiceConfig[]` — custom configs                               |
| `/api/services/config`            | POST   | `{ name, command, flags }` → создаёт/обновляет config            |
| `/api/services/config/:name`      | DELETE | Удаляет config + systemd-юнит                                    |
| `/api/services/managed/available` | GET    | `string[]` — все установленные системные сервисы (кроме custom)  |
| `/api/services/managed`           | GET    | `string[]` — пользовательская выборка управляемых сервисов       |
| `/api/services/managed`           | POST   | `{ name }` — добавить сервис в выборку                           |
| `/api/services/managed`           | DELETE | `{ name }` — удалить сервис из выборки                           |
| `/health`                         | GET    | `{ status: "ok", uptime: number }`                               |

**Custom** — сервисы с конфигом (`~/.config/aiservermanager/services/<name>.conf`): имя, команда, flags. Устанавливаются как systemd-юниты, управляются через "Add Service" / "Edit".

**Managed** — выбор пользователя из всех установленных systemd-сервисов (кнопка **"Manage"**). Список сохраняется в `~/.config/aiservermanager/managed-services.json`. Только start/stop/enable/disable.

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

// Сервисы — статус управляемых сервисов
interface ServiceStatus {
  name: string;
  running: boolean;
  enabled: boolean;
  installed: boolean; // зарегистрирован ли в ОС
  pid?: number;
  error?: string;
}
type ServiceAction = "start" | "stop" | "enable" | "disable";
```

Фронтенд мерджит `GpuInfo` + `GpuUsage` на клиенте (`GpuWithUsage`).

### Тесты backend

Jest 30 + ts-jest + supertest. 8 файлов тестов, 63 теста (включая safeExecPs1 + PCI domain normalization).

## Frontend

### Стек фронта

- **Angular 22** (standalone, signals, control flow `@if/@else`)
- **Angular Material 22** (Toolbar, Table, ProgressBar, Card, Chips, Button)
- **RxJS** — два независимых стрима: `fetchGpus()` (1 раз) + `watchUsage()` (poll 3s)
- **Zone.js** с `eventCoalescing: true`

### Компоненты

- `AppComponent` — compose layout: toolbar + GPU block + Services block
- `GpuTableComponent` — таблица GPU с input-сигналом `gpus()`. Визуализация bars (usage, vram), цветовые чипы по vendor
- `ServicesComponent` — карточки управляемых сервисов. Кнопки **Manage** (выбор managed) + **Add Service** (создание custom). `ServiceWithConfig` объединяет статус + config
- `ManagedServicesDialogComponent` — диалог с чекбоксами и фильтром для выбора managed сервисов
- `ServiceDialogComponent` — диалог создания/редактирования custom конфигов (name, command, flags)

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

- **Strategy** — `GpuDetector` / `GpuEnricher` / `GpuUsageProbe` / `ServiceController` интерфейсы
- **Two-phase** — bootstrap (static, cached) + polling (dynamic, per-request)
- **DI** — InversifyJS, platform-aware bindings, multi-inject
- **Signals** — Angular 22 reactive state management
- **Component composition** — AppComponent делегирует рендеринг подкомпонентам (GpuTable, Services)
