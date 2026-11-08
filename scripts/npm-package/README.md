# aiservermanager

GPU server monitoring and AI service manager web dashboard.
Monitors GPU utilization and manages llama.cpp / ComfyUI services through a web UI.

## Run

Requires Node.js >= 24.

```bash
npx --yes aiservermanager@latest
```

Open http://127.0.0.1:4243 and log in with your OS account password — the account
the backend runs as. Installed as a service that is the account recorded by
`install`, see [Login account](#login-account).

## Run as a system service

A backend without OS privileges cannot manage services, and one started from a
terminal stops when the terminal does. Installing it as a service solves both:

```bash
npm install -g aiservermanager
sudo aiservermanager install            # Linux → systemd unit
aiservermanager install                 # Windows → elevated PowerShell, WinSW wrapper
```

Then `aiservermanager status`, `restart`, `uninstall`.

- `--port <n>`, `--host <iface>` (default `127.0.0.1`; use `0.0.0.0` for LAN access)
- `--config-home <dir>` — whose `.config/aiservermanager` the service reads. The
  service runs as root / LocalSystem but keeps `HOME`/`USERPROFILE` on the
  installing user's home, so existing service configs stay visible.
- `--auth-user <name>` — whose password opens the dashboard (`NAME`, `HOST\NAME`
  or `NAME@domain`). Defaults to the user running the install.

The uninstall removes the OS registration and keeps your configs.

## Login account

The dashboard checks a real OS password, so it needs an account that *has* one.
The service runs as root / LocalSystem, and neither has a password anybody could
type, so `install` records the invoking user as `AUTH_USER` in the unit. Without
it the login answers that no account is configured rather than calling a correct
password wrong. Change it by installing again with `--auth-user <name>`, or by
setting `AUTH_USER` in the unit / WinSW XML and restarting the service.

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