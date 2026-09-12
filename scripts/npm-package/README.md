# aiservermanager

GPU server monitoring and AI service manager web dashboard.
Monitors GPU utilization and manages llama.cpp / ComfyUI services through a web UI.

## Run

Requires Node.js >= 24.

```bash
npx --yes aiservermanager@latest
```

Open http://127.0.0.1:4243 and log in with your OS account password.

## Linux: PAM auth

Password login on Linux uses PAM via the `authenticate-pam` module (built on install).
Install the PAM development headers first:

```bash
sudo apt install libpam0g-dev
```

Without them the module is skipped and password login is unavailable.

## Configuration

- Port and host: `PORT` and `HOST` environment variables (defaults: `4243`, `127.0.0.1`)
- Persistent state (auth secret, managed services, custom service configs):
  `~/.config/aiservermanager/`