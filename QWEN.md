# AI Server Manager

Мониторинг GPU-серверов в реальном времени. Отображает утилизацию, VRAM, температуру и PCI-адреса для NVIDIA и AMD GPU через веб-дашборд.

## Архитектура

Monorepo с двумя пакетами: **backend** (Node.js + Express + InversifyJS) и **frontend** (Angular 22 standalone).

```text
aiservermanager/
├── backend/
│   └── src/
│       ├── index.ts              # Express entry, port 4242
│       ├── types.ts              # GpuInfo interface
│       ├── di/                   # InversifyJS контейнер
│       ├── routes/               # REST: GET /api/gpus
│       └── services/
│           ├── exec.ts           # safeExec обёртка над child_process
│           ├── gpuService.ts     # Оркестратор: детекторы → дедуп → enrichers
│           ├── detectors/        # GpuDetector стратегия
│           │   ├── nvidiaSmiDetector.ts   # nvidia-smi (Win + Linux)
│           │   ├── amdLinuxDetector.ts    # rocm-smi (Linux)
│           │   └── wmiDetector.ts         # WMI PowerShell (Win)
│           └── enrichers/        # GpuEnricher стратегия
│               ├── lspciEnricher.ts       # lspci brand (Linux)
│               └── vulkanEnricher.ts      # vulkaninfo (Linux)
└── frontend/
    └── src/app/
        ├── app.component.ts       # Сигналы, Angular Material
        ├── app.component.html     # @if/@else шаблон, таблица GPU
        ├── models/gpu.ts          # Gpu интерфейс
        └── services/gpu.service.ts # HttpClient + RxJS polling (3s)
```

## Backend

### Стек бэка

- **Express 5** + **TypeScript 6** + **InversifyJS 8** (DI)
- Запускается на `PORT=4242`, `HOST=0.0.0.0` (env)

### Pipeline детекции GPU

1. **Детекторы** выполняются последовательно. Каждый проверяет `isAvailable()`, затем `detect()`.
2. **Дедупликация** по имени GPU. При коллизии сохраняется запись с большим количеством заполненных полей (score: usage +2, temp +2, vramUsed +1, vulkanName +1, pciBusId +1).
3. **Enrichers** выполняются параллельно, мутируют массив `GpuInfo[]` in-place.

### Platform-aware DI

Контейнер (`di/container.ts`) биндит детекторы в зависимости от `process.platform`:

- **Windows**: `NvidiaSmiDetector` + `WmiDetector`
- **Linux**: `NvidiaSmiDetector` + `AmdLinuxDetector` + `LspciEnricher` + `VulkanEnricher`

### `safeExec`

`child_process.exec` обёртка: `powershell.exe` на Windows, `/bin/sh` на Linux. Никогда не бросает exception, вместо этого возвращает `{ stdout: "", stderr: err.message }` при ошибке.

### API

- `GET /api/gpus` — массив `GpuInfo[]`
- `GET /health` — `{ status: "ok", uptime: number }`

### GpuInfo

```ts
interface GpuInfo {
  index: number;
  vendor: string; // "NVIDIA" | "AMD" | "Intel" | "Unknown"
  brand: string; // "NVIDIA" | "RADEON" | производитель платы
  name: string;
  vulkanName: string;
  vramTotal: number; // GB
  vramUsed: number; // GB
  usage: number; // GPU utilization %
  temperature: number; // Celsius
  pciBusId: string;
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

Современный Angular control flow (`@if`/`@else`), `CommonModule` не используется. Цветовая индикация: green <40%, orange <75%, red ≥75% (usage); green <60°C, orange <80°C, red ≥80°C (temp).

## Команды

| Команда                     | Описание                                                |
| --------------------------- | ------------------------------------------------------- |
| `npm run install:all`       | Установить зависимости root + backend + frontend        |
| `npm run dev`               | Запустить backend + frontend параллельно (concurrently) |
| `npm run build`             | Собрать frontend → `backend/public`                     |
| `cd backend && npm run dev` | Только backend (ts-node-dev --respawn)                  |
| `cd frontend && npm start`  | Только frontend (ng serve --port 4243)                  |
| `cd backend && npm test`    | Jest + supertest                                        |

## Паттерны

- **Strategy** — `GpuDetector` / `GpuEnricher` интерфейсы для подключаемых бэкендов
- **Pipeline** — детекторы (seq) → дедуп → enrichers (parallel)
- **DI** — InversifyJS, platform-aware bindings
- **Signals** — Angular 22 reactive state management
