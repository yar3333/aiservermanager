# AI Server Manager

Web application to monitor and manage GPU servers running llama.cpp and ComfyUI.

## Features

- **GPU Dashboard** — Real-time list of all GPUs (NVIDIA / AMD) with:
  - Vendor, brand, model name
  - Vulkan device name
  - VRAM usage (with visual progress bars)
  - GPU utilization %
  - Temperature
  - PCI bus ID
- **Auto-refresh** — Data updates every 3 seconds
- **Cross-platform** — Linux (primary) and Windows support

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express, TypeScript |
| Frontend | Angular 19, Angular Material |
| GPU detection | `nvidia-smi`, `rocm-smi`, `lspci`, `vulkaninfo` (Linux) / PowerShell WMI (Windows) |

## Quick Start

```bash
# Install all dependencies
npm run install:all

# Development mode (backend on :4242, frontend on :4243)
npm run dev

# Or start separately
npm run dev:backend   # http://localhost:4242
npm run dev:frontend  # http://localhost:4243
```

Open **http://localhost:4243** in your browser. The frontend proxies API requests to the backend.

## Production Build

```bash
npm run build
npm run start:backend
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gpus` | GET | Returns array of GPU info objects |
| `/health` | GET | Health check |

## GPU Detection

### Linux
- **NVIDIA**: `nvidia-smi --query-gpu=... --format=csv`
- **AMD**: `rocm-smi --showproductname --json` (and related queries)
- **Vulkan names**: `vulkaninfo --summary`
- **PCI brands**: `lspci -vnn`

### Windows
- **NVIDIA**: `nvidia-smi` (if installed)
- **Fallback**: PowerShell `Get-CimInstance Win32_VideoController`

## Project Structure

```
aiservermanager/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Express server
│   │   ├── types.ts          # Shared types
│   │   ├── routes/
│   │   │   └── gpuRoutes.ts  # GPU REST endpoints
│   │   └── services/
│   │       └── gpuService.ts # GPU detection logic
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── app.component.*    # Main GPU dashboard
│   │   │   ├── app.config.ts      # Angular app config
│   │   │   ├── models/gpu.ts      # GPU type
│   │   │   └── services/gpu.service.ts  # HTTP client
│   │   ├── main.ts
│   │   └── index.html
│   ├── angular.json
│   ├── proxy.conf.json
│   └── package.json
└── package.json              # Root workspace
```
