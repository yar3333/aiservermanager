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
│       │   ├── wmiGpuQuery.ps1       # PS1 script: WMI + HKLM registry → pciBusId (BB:DD.F)
│       │   ├── grantLogonServiceRight.ps1 # PS1: выдать учётке SeServiceLogonRight через LSA
│       │   └── winsw/                # Bundled WinSW host for Windows services (scripts/get-winsw.ps1)
│       │       └── WinSW-x64.exe     # Windows Service Wrapper 2.12.0 (MIT), pinned + hash-checked
│       ├── models/
│       │   ├── GpuInfo.ts            # GpuInfo (static), GpuUsage, GpuState
│       │   ├── ServiceStatus.ts      # ServiceStatus, ServiceAction
│       │   └── ServiceConfig.ts      # ServiceConfig + парсер .conf (type/command/unit.user/unit.password/unit.group/unit.restart/unit.cwd/unit.stop/env.K)
│       ├── di/
│       │   ├── types.ts              # InversifyJS injection tokens
│       │   └── container.ts          # Platform-aware DI container
│       ├── routes/
│       │   ├── gpuRoutes.ts          # GET / /usage /state
│       │   ├── serviceRoutes.ts      # Services API + managed services CRUD
│       │   ├── systemRoutes.ts       # GET /info (SystemInfoProvider), POST /reboot, POST /shutdown
│       │   └── __tests__/
│       ├── helpers/
│       │   ├── ExecTools.ts          # safeExec (platform-aware shell), safeExecPs1 (.ps1 files)
│       │   └── ServerIdentity.ts     # PID, listen address, start time, privilege level of this process
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
│           │   └── windowsServiceController.ts # sc.exe + WinSW host (Windows)
│           ├── helpers/
│           │   ├── gpuDedup.ts       # deduplicateGpus() + staticScore()
│           │   ├── winswConfig.ts    # Чистый билдер XML-конфига WinSW (executable/args/env/restart/serviceaccount/stop)
│           │   └── winswLog.ts       # parseWinSwLogLine(): таймстемп WinSW → JournalLine
│           ├── detectors/            # Static GPU info (run once)
│           │   ├── gpuDetector.ts    # GpuDetector стратегия
│           │   ├── nvidiaSmiDetector.ts  # nvidia-smi (Win + Linux)
│           │   ├── amdLinuxDetector.ts   # rocm-smi (Linux)
│           │   ├── wmiDetector.ts        # WMI PowerShell (Win) + registry for pciBusId
│           │   └── __tests__/
│           ├── enrichers/            # Enrich static info
│           │   ├── gpuEnricher.ts    # GpuEnricher стратегия
│           │   ├── lspciEnricher.ts  # lspci brand (Linux)
│           │   └── __tests__/
│           ├── resolvers/            # Runtime device number (gpuIndex)
│           │   ├── gpuIndexResolver.ts         # GpuIndexResolver стратегия
│           │   ├── sysfsRenderIndexResolver.ts # /sys/class/drm render-порядок (Linux)
│           │   ├── listOrderIndexResolver.ts   # Порядок списка детекторов (fallback)
│           │   └── __tests__/
│           ├── probes/               # Dynamic metrics polling
│           │   ├── gpuUsageProbe.ts      # GpuUsageProbe стратегия
│           │   ├── nvidiaSmiUsageProbe.ts
│           │   └── amdLinuxUsageProbe.ts
│           ├── systemInfoProvider.ts   # SystemInfoProvider стратегия + типы
│           ├── providers/            # Platform-aware system info (Strategy)
│           │   ├── systemInfoLinuxProvider.ts     # /etc/os-release, df, stat
│           │   ├── systemInfoWindowsProvider.ts   # Win32 CIM (OS, disks, .evtx logs)
│           │   └── __tests__/
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
        │   ├── journal-panel/        # Правая панель — журнал логов выбранного сервиса
        │   ├── system-bar/           # System panel (CPU, RAM) + server actions menu
        │   │   ├── system-bar.component.ts
        │   │   └── system-info-dialog.component.ts # System info dialog (OS, disks, logs)
        │   └── services/             # Карточки управления сервисами
        │       ├── service-dialog/   # Диалог создания/редактирования llama-конфигов
        │       ├── account-password-dialog/ # Мини-диалог пароля учётки: спрашивается в момент регистрации
        │       ├── managed-services-dialog/ # Диалог выбора системных сервисов
        │       └── archive-dialog/   # Диалог архива: перемещение сервисов в архив/из архива
        ├── models/
        │   ├── gpu.ts                # Gpu, GpuUsage, SystemInfoDetail, DiskInfo, LogFileInfo
        │   └── service.ts            # ServiceStatus, ServiceAction, ServiceConfig
        ├── utils/
        │   ├── context-size.ts       # parseContextSize/formatContextSize, пресеты контекста
        │   ├── run-as-fields.ts      # buildRunAsLabels (тексты, плейсхолдер user и признак блокировки по ОС бэкенда)
        │   └── disabled-controls.ts  # syncDisabledControls: блокирует поля через control.disable(), а не [disabled]
        └── services/
            ├── gpu.service.ts        # fetchGpus() + watchUsage()
            ├── service.service.ts    # Services API + managed services + journal
            ├── account-password.service.ts # accountPassword.askFor(cfg) — пароль ровно когда он нужен
            ├── system.service.ts     # getSystemInfo(), reboot(), shutdown() + detectWindows()/windows (ОС бэкенда, один запрос)
            └── selected-service.service.ts # Shared signal: выбранный сервис для журнала
```

## Backend

### Стек бэка

- **Express 5** + **TypeScript 6** + **InversifyJS 8** (DI)
- Запускается на `PORT=4242`, `HOST=0.0.0.0` (env)
- CORS включён (`cors()` middleware)
- Статические файлы: `backend/public/browser/`, SPA fallback (`index.html`)

### Двухфазная модель данных

**Bootstrap (один раз)**: детекторы → дедуп → enrichers → index resolvers → сортировка по `gpuIndex` → кэш `GpuInfo[]`.

**Polling (каждый запрос)**: usage probes → merge по `pciBusId` → `GpuState[]`.

Детекторы собирают только статические поля (`name`, `vramTotal`, `pciBusId`). Usage probes опрашивают только динамические (`usage`, `temperature`, `vramUsed`).

### Bootstrap pipeline

1. **Детекторы** выполняются последовательно. Каждый проверяет `isAvailable()`, затем `detect()`.
2. **Дедупликация** по `vendor:pciBusId` (fallback: `vendor:name`). При коллизии сохраняется запись с большим score: `pciBusId` +2, `vramTotal` +1, brand ≠ vendor +1.
3. **Enrichers** выполняются параллельно (`Promise.all`), мутируют `GpuInfo[]` in-place.
4. **Определение номера устройства (`gpuIndex`)**: index resolvers исполняются в порядке DI-биндингов; побеждает первый, назначивший хотя бы один номер. Linux — `SysfsRenderIndexResolver`: перечисляет `/sys/class/drm/cardN` с render-узлом (карты без render-узла — BMC iGPU, ASPEED — отбрасываются); номер = позиция в порядке карточек = порядок probe ядра = порядок HIP. Fallback (Windows, нет совпадений) — `ListOrderIndexResolver`: порядковый номер в списке детектора.
5. **Сортировка**: итоговый список сортируется по `gpuIndex`.

### Usage probes

Лёгкие запросы только динамических метрик. Биндятся к `GPU_USAGE_PROBE`:

- **Windows**: `NvidiaSmiUsageProbe` — `nvidia-smi` (index, usage, temp, vramUsed, pci)
- **Linux**: `NvidiaSmiUsageProbe` + `AmdLinuxUsageProbe` — `rocm-smi` (temp, usage, vramUsed)

### Platform-aware DI

Контейнер (`di/container.ts`) биндит компоненты в зависимости от `process.platform`:

| Токен                  | Windows                   | Linux                                               |
| ---------------------- | ------------------------- | --------------------------------------------------- |
| `GPU_DETECTOR`         | NvidiaSmi + Wmi           | NvidiaSmi + AmdLinux                                |
| `GPU_ENRICHER`         | —                         | Lspci                                               |
| `GPU_INDEX_RESOLVER`   | ListOrder                 | Sysfs + ListOrder                                   |
| `GPU_USAGE_PROBE`      | NvidiaSmiUsageProbe       | NvidiaSmiUsageProbe + AmdLinuxUsageProbe            |
| `SERVICE_CONTROLLER`   | WindowsServiceController  | SystemctlController + WindowsServiceController      |
| `SYSTEM_INFO_PROVIDER` | SystemInfoWindowsProvider | SystemInfoLinuxProvider + SystemInfoWindowsProvider |

Все контроллеры сервиса биндятся всегда (multi-inject). `ServiceManager` выбирает активный через `isAvailable()` — на Windows работает `WindowsServiceController`, на Linux — `SystemctlController`.

`SYSTEM_INFO_PROVIDER` — multi-inject, роут резолвит активный через `isAvailable()` и вызывает `getSystemInfo()`.

**Linux** (`systemctl`):

- `systemctl is-active <name>` — статус запущенности
- `systemctl is-enabled <name>` — автозагрузка
- `systemctl show --property=MainPID --value` — PID
- `systemctl start|stop|enable|disable <name>` — управление
- `systemctl list-unit-files --type=service` — discover всех сервисов (исключает custom)

**Windows** (`sc.exe` + PowerShell fallback `Get-Service`):

- `sc.exe queryex <name>` — STATE и PID (типа запуска там нет — его читают через `Get-Service … .StartType`)
- `sc.exe start|stop <name>` — запуск/остановка
- `sc.exe config <name> start= auto|demand` — включение/отключение
- `Get-Service` — discover всех Windows-сервисов, плюс `StartType` для признака `enabled`

### `ExecTools`

`safeExec()` — обёртка над `child_process.exec` с promisify. `powershell.exe` на Windows, `/bin/sh` на Linux. Таймаут 10 секунд.

`safeExecPs1(scriptPath)` — `child_process.spawn` для выполнения `.ps1` файлов. Избегает проблем с экранированием при передаче сложных скриптов через `exec`. Оба метода никогда не бросают exception, возвращают `{ stdout: "", stderr: err.message }` при ошибке.

### API

| Endpoint                          | Method | Описание                                                            |
| --------------------------------- | ------ | ------------------------------------------------------------------- |
| `/api/gpus`                       | GET    | `GpuInfo[]` — статическая информация, отсортирована по `gpuIndex` (1 раз при инициализации) |
| `/api/gpus/usage`                 | GET    | `GpuUsage[]` — динамические метрики (поллинг каждые 3с)             |
| `/api/services`                   | GET    | `ServiceStatus[]` — статус управляемых сервисов                     |
| `/api/services/control`           | POST   | `{ name, action }` → `ServiceStatus` — start/stop/enable/disable    |
| `/api/services/install`           | POST   | `{ name, runAsPassword? }` → регистрирует custom-сервис в ОС        |
| `/api/services/config`            | GET    | `ServiceConfig[]` — custom configs                                  |
| `/api/services/config`            | POST   | `{ name, command, flags, runAsPassword? }` → создаёт/обновляет config |
| `/api/services/config/:name`      | DELETE | Удаляет config + systemd-юнит                                       |
| `/api/services/config/:name/archive` | POST | Архивирует: stop (если запущен) + uninstall юнита + config → `services-archive/` |
| `/api/services/config/:name/restore` | POST | Восстанавливает из архива: config → `services/` + reinstall юнита (без enable); `runAsPassword?` — пароль учётки |
| `/api/services/archive`           | GET    | `ServiceConfig[]` — архивные конфиги                                |
| `/api/services/managed/available` | GET    | `string[]` — все установленные системные сервисы (кроме custom)     |
| `/api/services/managed`           | GET    | `string[]` — пользовательская выборка управляемых сервисов          |
| `/api/services/managed`           | POST   | `{ name }` — добавить сервис в выборку                              |
| `/api/services/managed`           | DELETE | `{ name }` — удалить сервис из выборки                              |
| `/api/services/journal/:name`     | GET    | `JournalLine[]` — последние строки журнала сервиса (param: `lines`). Linux — journalctl, Windows — логи WinSW |
| `/api/system/info`                | GET    | `SystemInfoDetail` — OS, hostname, kernel, uptime, disks, logs + `server` (идентичность бэкенда: pid, host:port, startedAt, privileged) |
| `/api/system/reboot`              | POST   | Reboot the server (Linux `sudo reboot` / Windows `shutdown /r`)     |
| `/api/system/shutdown`            | POST   | Shutdown the server (Linux `sudo poweroff` / Windows `shutdown /s`) |
| `/health`                         | GET    | `{ status: "ok", uptime: number }`                                  |

**Custom** — сервисы с конфигом (`~/.config/aiservermanager/services/<name>.conf`): имя, команда, flags. Устанавливаются как systemd-юниты, управляются через "Add Service" / "Edit".

**Managed** — выбор пользователя из всех установленных systemd-сервисов (кнопка **"Manage"**). Список сохраняется в `~/.config/aiservermanager/managed-services.json`. Только start/stop/enable/disable.

**Archive** — архив custom-сервисов (кнопка **"Archive"**, диалог `ArchiveDialogComponent`). Перемещение в архив: stop (если запущен) → uninstall юнита → конфиг переносится из `services/` в `~/.config/aiservermanager/services-archive/`. Извлечение: конфиг возвращается в `services/` и юнит переустанавливается (без enable/start). Архивные сервисы исчезают из списка статусов и не переустанавливаются при `bootstrap()`.

### Windows: хост WinSW для custom-сервисов

SCM принимает только EXE, который сам докладывает о своём состоянии (`StartServiceCtrlDispatcher`). Обычная программа или `.cmd`-обёртка (ComfyUI, `llama-server`) таким не является: `sc create` для них регистрирует сервис, который не стартует никогда. Поэтому `install()` на Windows регистрирует сервис через **WinSW** (Windows Service Wrapper, MIT; бинарь в `backend/src/files/winsw/`, путь переопределяется `AISERVERMANAGER_WINSW`):

- На каждый сервис — каталог `~/.config/aiservermanager/winsw/<name>/` с `<name>.xml` и `<name>.exe`. `<name>.exe` — **hard-link** на бинарь WinSW: WinSW ищет конфиг по имени собственного exe, поэтому без отдельного файла на сервис не обойтись, а ссылка не дублирует ~17 МБ. Fallback — копирование (другой том).
- `<executable>`/`<arguments>` строятся из `command` + `flags` конфига (`services/helpers/winswConfig.ts`). `.cmd`/`.bat` идут через `cmd.exe /d /c "…"`, и для них включается `<stopparentprocessfirst>`, чтобы консоль корректно завершала дочерний процесс.
- `<workingdirectory>` = `unit.cwd=` из конфига, иначе каталог программы: скрипты вида `pushd bin\ComfyUI-amd` работают только из своего каталога. Linux-аналог — `WorkingDirectory=` в юните.
- `<serviceaccount>` строится из `unit.user=` + пароля из тела запроса. Без `unit.user=` сервис работает от **LocalSystem**: другой `%USERPROFILE%`/`%APPDATA%`, ни git-кредов, ни пользовательских путей. Формы имени: `NAME` → `<domain>.</domain>` (локальная учётка, чтобы опечатка в домене не разрешилась «как-нибудь»), `DOMAIN\NAME`, `.\NAME`, `NAME@domain` (UPN — `<domain>` не пишется). Без пароля install не регистрирует ничего и отвечает, что нужен пароль.
- **Пароль учётки на диске не хранится нигде**: `serializeConfig` его не пишет, `parseConfigFile` его выбрасывает (ключ распознаётся, чтобы строка `unit.password=` не уехала в аргументы команды). SCM получает пароль один раз при регистрации (`ChangeServiceConfig`) и дальше сам хранит его в защищённом LSA-секрете и запускает под учёткой сервис, поэтому в XML он нужен только в момент install: после успешной регистрации `dropAccountPassword()` перезаписывает конфиг без `<password>`.
- Отсюда — **пароль спрашивается в момент, когда он нужен** (`AccountPasswordService.askFor` + `AccountPasswordDialogComponent`): Install, Reinstall, Save/Edit и Restore из архива показывают мини-диалог, если у конфига задан `unit.user=` и бэкенд отвечает `platform=win32`. Введённый пароль идёт в одном теле запроса (`runAsPassword`) и сразу забывается; «Отмена» прерывает действие, а не регистрирует сервис с пустым паролем. В диалоге настроек поля пароля нет.
- Право «Log on as a service» учётка должна получить **до первого старта**: SCM отказывает во входе (старт падает с 1069, в System-логе — событие 7041 «the user has not been granted the requested logon type»), а регистрация сервиса сама по себе его не выдаёт (в WinSW 2.12 этого нет). Поэтому install сначала вызывает `files/grantLogonServiceRight.ps1`: она добавляет `SeServiceLogonRight` через LSA (`LsaAddAccountRights` — то же хранилище, что правит secpol.msc) и идемпотентна. Имя учётки уходит в скрипт переменными окружения (`SM_ACCOUNT_DOMAIN`/`SM_ACCOUNT_NAME`), не через командную строку; форму `.` из XML LSA не понимает, её `logonRightIdentity()` разворачивает в `COMPUTERNAME`. Выдача права требует «Manage auditing and security log», поэтому без повышенного бэкенда install спотыкается именно на этом шаге — и делает это до удаления прежней регистрации, чтобы не оставить сервис вообще без неё.
- Если право отобрали уже после регистрации (перенастроил GPO) либо у учётки сменили пароль, старт снова даст 1069 — к ошибке `start` добавлена подсказка, что делать (Reinstall с текущим паролем или secpol.msc); опознаёт её `logonFailureHint()`. Linux-аналог — `User=` (ни права, ни пароль не нужны); `unit.group=` на Windows игнорируется. Смена пароля учётки = Reinstall.
- `unit.stop=` → `<stopexecutable>`/`<stoparguments>`, на Linux — `ExecStop=`. Нужен, когда программа не реагирует на stop. На Windows две ловушки, обе измерены на 2.12: WinSW **добавляет к стоп-команде аргументы самого сервиса** и **не подставляет никакой pid** (`%d` доходит до процесса буквально, плейсхолдера в сборке нет), а после запуска стоп-команды ждёт выхода основного процесса — то есть команда, которая ничего не убивает, вешает Stop в STOP_PENDING навсегда. Логику «убить дерево» надо класть в свой скрипт.
- Для `.cmd`/`.bat`-обёрток install пишет `<stoptimeout>5 sec</stoptimeout>` (`BATCH_STOP_TIMEOUT`), если своей стоп-команды нет: `cmd.exe` отвечает на сигнал остановки вопросом «Terminate batch job (Y/N)?», ответить в сервисе некому, и дефолтные 15 секунд WinSW просто сжигает перед тем же kill. Замерено на пробном сервисе (`cmd` → `ping`, конфиг собран `buildWinSwXml`): **15,3 с → 5,2 с**, дерево умирает целиком, сирот нет (`orphans of <service pid>: 0`), лог чистый. Обыческой программе окно не укорачивается. Элемент называется именно `<stoptimeout>`: `<stopwaitsecs>` в этой сборке отсутствует и молча не действует.
- Панель журнала: строки собственного лога WinSW несут время события — оно выносится в `timestamp` и убирается из текста (`services/helpers/winswLog.ts`); «сырому» выводу программы времени неоткуда взяться, там остаётся mtime файла.
- **Linux знает только голое имя учётки.** `systemd` резолвит `User=` по своим правилам (`USER_GROUP_REGEX`), поэтому windows-форма `HOST\user`, `.\user` или `user@domain` для него — не имя. Раньше такое значение молча не попадало в юнит и программа стартовала от root; теперь `install()` первым делом вызывает `systemdRunAsUserError()` и при несовпадении не пишет юнит, а возвращает ошибку с объяснением (голое имя или пустое поле = root намеренно). Фронтенд печатает её же при Save/Install/Reinstall/Restore, а плейсхолдер поля (`runAs.userPlaceholder()`) подсказывает `HOST\user` только на Windows-бэкенде. На save валидация кроссплатформенная: `isServiceAccount` для user, `USER_GROUP_REGEX` для group.
- `<startmode>Manual</startmode>` — install не включает автозапуск, как и раньше; `enable`/`disable` — это `sc config start= auto|demand`.
- **`disable` = `demand` (Manual), а не `disabled`**, по тому же смыслу, что и `systemctl disable`: автозапуск снят, запустить вручную можно. `start= disabled` делал сервис незапускаемым вообще — `sc start` отвечал `[SC] StartService FAILED 1058`, и кнопка Start в дашборде переставала работать до «включения».
- **`enabled` в `ServiceStatus` = «автозагрузка»**, и на Windows этому соответствует только `StartType = Automatic`; `Manual` и `Disabled` дают `enabled: false`. Тип запуска читают из `Get-Service <name>.StartType`, потому что `sc.exe queryex` его не печатает (там есть только STATE и PID), а `sc qc` отдал бы числовой код.
- Логи — `<logpath>` в каталог сервиса, `roll-by-size` (10 МБ × 3). Оттуда же читается панель журнала на Windows: `<name>.out.log`, fallback — самый свежий `*.log`.
- Повторный `install` = uninstall + install (WinSW не обновляет конфиг на месте). `createOrUpdate` возвращает сервису прежние состояния enabled/running; **Reinstall** в меню сервиса делает принудительную переустановку — например при переходе со старой регистрации `sc create`.
- Переменные окружения пишутся в XML как `<env>`; значение `HKLM\SYSTEM\CurrentControlSet\Services\<name>\Environment`, оставленное прежними версиями контроллера, при install удаляется, иначе SCM подмешивает его повторно.
- Действия, которые невозвышенный токен всё равно не выполнит (install/uninstall/start/stop/enable/disable), отвечают внятной ошибкой с PID бэкенда вместо сырого `OpenService FAILED 5`. WinSW умеет сам запросить повышение при install, но контроллер этого не допускает: UAC-промпт из фонового процесса неприемлем, а `sc.exe`-действия всё равно не повышаются.

### Модели

```ts
// Статические — не меняются
interface GpuInfo {
  index: number;
  vendor: string; // "NVIDIA" | "AMD" | "Intel" | "Unknown"
  brand: string; // "MSI" | "ASROCK" | "GIGABYTE" | производитель платы
  name: string;
  gpuIndex: number; // runtime-номер устройства (HIP/CUDA); на Linux — из порядка /sys/class/drm render-узлов
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

// Журнал сервиса
interface JournalLine {
  timestamp: string;
  message: string;
}

// System info (GET /api/system/info)
interface OsRelease {
  name: string;
  version: string;
  id: string;
}

interface DiskInfo {
  device: string;
  mountPoint: string;
  total: number; // bytes
  used: number;
  available: number;
  usePercent: number;
}

interface LogFileInfo {
  path: string;
  size: number; // bytes
  exists: boolean;
}

interface SystemInfoDetail {
  os: OsRelease;
  hostname: string;
  kernel: string;
  uptime: string;
  disks: DiskInfo[];
  logs: LogFileInfo[];
}
```

Фронтенд мерджит `GpuInfo` + `GpuUsage` на клиенте (`GpuWithUsage`).

### Тесты backend

Jest 30 + ts-jest + supertest. 28 файлов тестов; если исключить `hfDownloadsService.test.ts` (см. ниже) — 27 сьютов и 317 тестов, все зелёные.

`hfDownloadsService.test.ts` на этой машине не проходит в обоих режимах и к коду отношения не имеет: без повышенного токена 37 тестов падают с `EPERM: operation not permitted, symlink` (симлинки в тестовой обвязке), с повышенным токеном симлинки создаются и 20 тестов падают уже на `HF downloads monitoring is only available on Linux` — сам сервис рассчитан на Linux. Остальные сьюты зелёные; `exec.test.ts` под сильной нагрузкой машины иногда падает по 5-секундному таймауту и проходит при запуске один на один (`--runInBand`).

## Frontend

### Стек фронта

- **Angular 22** (standalone, signals, control flow `@if/@else`)
- **Angular Material 22** (Toolbar, Table, ProgressBar, Card, Chips, Button)
- **RxJS** — два независимых стрима: `fetchGpus()` (1 раз) + `watchUsage()` (poll 3s)
- **Zone.js** с `eventCoalescing: true`
- **Jest 30** + **jest-preset-angular 17** (тесты: `cd frontend && npm test`)

### Компоненты

- `AppComponent` — compose layout: toolbar + GPU block + Services block, draggable splitter для правой панели
- `GpuTableComponent` — таблица GPU с input-сигналом `gpus()`. Визуализация bars (usage, vram), цветовые чипы по vendor. Колонка `#` показывает runtime-номер устройства (`gpuIndex`), нулевой горизонтальный padding. Список приходит от бэкенда уже отсортированным по `gpuIndex`
- `JournalPanelComponent` — правая панель с журналом логов. Выпадающий список сервисов (включая «— None —» для отключения). Поллинг каждые 1с через `fetchJournal()`, автопрокрутка вниз, ручной скролл сохраняется. Ширина панели настраивается через drag splitter (persist в localStorage)
- `SystemBarComponent` — панель CPU/RAM + menu (System Info, Reboot, Shutdown)
- `SystemInfoDialogComponent` — диалог с информацией о системе (OS, hostname, kernel, uptime, disks, logs) + секция **Backend**: PID, адрес, время запуска и признак достаточных прав — по ней видно, что дашборд отвечает поднятый вслепую старый экземпляр бэкенда
- `ServicesComponent` — карточки управляемых сервисов. Кнопки **Manage** (выбор managed) + **Add Service** (создание custom) + **Archive** (архив). В меню сервиса — **Reinstall** (пересоздать регистрацию из конфига). Install/Reinstall/Save перед запросом просят пароль учётки через `AccountPasswordService` (отмена = действие не выполняется). Баннер над списком предупреждает, если бэкенд, отвечающий на запросы, работает без прав, достаточных для управления сервисами. `ServiceWithConfig` объединяет статус + config
- `ManagedServicesDialogComponent` — диалог с чекбоксами и фильтром для выбора managed сервисов
- `ServiceDialogComponent` — диалог создания/редактирования custom конфигов (name, command, flags, user, group, restart). Поля пароля нет: пароль спрашивается в момент регистрации сервиса. `unit.cwd=` и `unit.stop=` поля не имеют — сохраняются из читаемого конфига. Подсказки user/group и блокировка поля group берутся из `runAs` (`utils/run-as-fields.ts`) по ОС бэкенда: на Windows group заблокирован, значение при этом продолжает сохраняться в конфиг. Блокируются поля не атрибутом, а `utils/disabled-controls.ts` → `syncDisabledControls(this.form, () => ({ … }))`: `[disabled]` на элементе с `formControlName` Angular игнорирует (в dev-режиме пишет предупреждение), так что раньше name при редактировании существующего конфига оставался редактируемым
- `AccountPasswordDialogComponent` / `AccountPasswordService.askFor(cfg)` — мини-диалог пароля учётки: открывается только если у конфига задан `user` и бэкенд на Windows (`SystemService.windows`; ответ `GET /api/system/info → server.platform` кэшируется на всё приложение). Возвращает строку-пароль, `undefined` (спрашивать не нужно) или `null` (отменено — вызывающий не выполняет действие)
- `ArchiveDialogComponent` — диалог архива с двумя панелями (active / archive). Перемещение в архив останавливает и деинсталлирует сервис, переносит конфиг в `services-archive/`; извлечение возвращает конфиг и переустанавливает юнит (при `unit.user=` сначала спрашивает пароль)

### Состояние компонента

```ts
readonly gpus    = signal<GpuWithUsage[]>([]); // static + usage, merged on client
readonly loading = signal(true);
readonly error   = signal<string | null>(null);
readonly hasGpus = computed(() => this.gpus().length > 0);
```

Компонент загружает статическую информацию один раз, затем подписывается на `watchUsage()` и мерджит usage по `pciBusId` в кэшированные GPU-записи.

## Команды

| Команда                     | Описание                                                |
| --------------------------- | ------------------------------------------------------- |
| `npm run install:all`       | Установить зависимости root + backend + frontend        |
| `npm run dev`               | `ng build --watch` + `ts-node-dev` параллельно          |
| `npm run build`             | `tsc` (backend) + `ng build` → `../backend/public`      |
| `cd backend && npm run dev` | Только backend (ts-node-dev --respawn)                  |
| `cd backend && npm test`    | Jest --verbose                                          |
| `cd frontend && npm test`   | Jest (jest-preset-angular), watch: `npm run test:watch` |
| `powershell -ExecutionPolicy Bypass -File scripts/get-winsw.ps1` | Скачать WinSW нужной версии и проверить SHA-256 (Windows, нужно только при сборке/обновлении хоста) |

### Выпуск версии

1. Закоммитить изменения фичи.
2. `npm version patch` (или `minor`/`major`) в корне — обновит `version` в `package.json` и создаст git-коммит + тег `vX.Y.Z`.
3. `git push origin master --tags` — пуш тега запускает GitHub Actions workflow `publish.yml` (Build and Publish to npm).

## Паттерны

Предпочтение Signal, потом Promise и только в крайнем случае Observable.

- **Strategy** — `GpuDetector` / `GpuEnricher` / `GpuUsageProbe` / `ServiceController` / `SystemInfoProvider` интерфейсы
- **Two-phase** — bootstrap (static, cached) + polling (dynamic, per-request)
- **DI** — InversifyJS, platform-aware bindings, multi-inject
- **Signals** — Angular 22 reactive state management. `effect()` только в field initializer или конструкторе (NG0203: требует injection context). `takeUntilDestroyed()` аналогично — только в field initializer/конструкторе, иначе «macro task» ошибка.
- **Component composition** — AppComponent делегирует рендеринг подкомпонентам (GpuTable, Services)
