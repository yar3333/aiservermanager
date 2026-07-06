# aiservermanager - web application to manage llama.cpp and comfyui on your server

Support Linux (and Windows in future).

Install `aiservermanager` on your server or specify server ssh address to connect (like `yar@yserver`) in config file. After that, use your web browser to connect to web app (default port is 4242).

## Technology

### Frontend

- recent stable Angular / Material

### Backend

- typescript / nodejs / Express (recent stable version)
- node use utilities like `rocm-smi`, `vulkaninfo`, `lspci`, `nvidia-smi`, `journalctl` on Linux
- node use powershell 5.1 (built-in) on Windows

## GUI

### Main screen

- list of GPU in system (NVIDIA/AMD, vendor (RADEON, ASROCK, MSI, etc), vulkan name, VRAM, GPU usage, temperature, pci bus)
