"""
line-claude CLI — manage the LINE-Claude bridge as a background service.

Commands:
  line-claude setup          Install cloudflared + verify .env (run once)
  line-claude start          Start bridge + tunnel in background
  line-claude stop           Stop background processes
  line-claude status         Show running state
  line-claude logs           Tail the bridge log
  line-claude install        Write a systemd user service and enable it
  line-claude uninstall      Remove the systemd service
"""

import os
import signal
import subprocess
import sys
from pathlib import Path

import typer

app = typer.Typer(help="LINE-Claude bridge manager", add_completion=False)

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
_HERE = Path(__file__).parent.resolve()
STATE_DIR = Path.home() / ".line-claude"
BRIDGE_PID = STATE_DIR / "bridge.pid"
TUNNEL_PID = STATE_DIR / "tunnel.pid"
LOG_FILE = STATE_DIR / "bridge.log"
SYSTEMD_DIR = Path.home() / ".config" / "systemd" / "user"
SERVICE_NAME = "line-claude-bridge.service"


def _ensure_state_dir() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (_HERE / "data").mkdir(exist_ok=True)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _read_pid(path: Path) -> int | None:
    try:
        pid = int(path.read_text().strip())
        os.kill(pid, 0)   # raises if not running
        return pid
    except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError):
        return None


def _kill_pid(path: Path, name: str) -> bool:
    pid = _read_pid(path)
    if pid is None:
        return False
    try:
        os.kill(pid, signal.SIGTERM)
        path.unlink(missing_ok=True)
        typer.echo(f"  stopped {name} (pid {pid})")
        return True
    except ProcessLookupError:
        path.unlink(missing_ok=True)
        return False


def _env_path() -> Path:
    p = _HERE / ".env"
    if not p.exists():
        typer.echo(f"[error] .env not found at {p}", err=True)
        typer.echo("  Run: cp .env.example .env  and fill in your keys", err=True)
        raise typer.Exit(1)
    return p


def _get_env(key: str) -> str:
    """Read a single key from .env without importing dotenv."""
    for line in (_HERE / ".env").read_text().splitlines():
        line = line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() == key:
            return v.strip().strip('"').strip("'")
    return ""


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
@app.command()
def setup() -> None:
    """Install cloudflared and verify .env is ready (run once after cloning)."""
    import shutil
    import urllib.request

    ok = True

    # 1. cloudflared
    typer.echo("Checking cloudflared...")
    if shutil.which("cloudflared"):
        result = subprocess.run(["cloudflared", "--version"], capture_output=True, text=True)
        typer.echo(typer.style(f"  ✓ {result.stdout.strip()}", fg=typer.colors.GREEN))
    else:
        typer.echo("  not found — installing to ~/.local/bin/cloudflared ...")
        bin_dir = Path.home() / ".local" / "bin"
        bin_dir.mkdir(parents=True, exist_ok=True)
        dest = bin_dir / "cloudflared"
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
        try:
            with urllib.request.urlopen(url) as r, open(dest, "wb") as f:
                f.write(r.read())
            dest.chmod(0o755)
            typer.echo(typer.style(f"  ✓ installed to {dest}", fg=typer.colors.GREEN))
            typer.echo("  Make sure ~/.local/bin is on your PATH:")
            typer.echo('    echo \'export PATH="$HOME/.local/bin:$PATH"\' >> ~/.bashrc && source ~/.bashrc')
        except Exception as e:
            typer.echo(typer.style(f"  ✗ download failed: {e}", fg=typer.colors.RED), err=True)
            typer.echo("  Install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/")
            ok = False

    # 2. .env
    typer.echo("\nChecking .env...")
    env_file = _HERE / ".env"
    if not env_file.exists():
        typer.echo("  not found — creating from .env.example ...")
        import shutil as sh
        sh.copy(_HERE / ".env.example", env_file)
        typer.echo(typer.style(f"  ✓ created {env_file}", fg=typer.colors.GREEN))
        typer.echo("  Edit it and fill in your keys, then run 'line-claude start'")
        ok = False
    else:
        required = ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN",
                    "OPENROUTER_API_KEY", "CLOUDFLARE_TUNNEL_TOKEN"]
        missing = [k for k in required if not _get_env(k)]
        if missing:
            for k in missing:
                typer.echo(typer.style(f"  ✗ {k} not set in .env", fg=typer.colors.RED))
            ok = False
        else:
            typer.echo(typer.style("  ✓ all required keys present", fg=typer.colors.GREEN))

    typer.echo()
    if ok:
        typer.echo(typer.style("Setup complete. Run: line-claude start", fg=typer.colors.GREEN))
    else:
        typer.echo("Fix the issues above, then run: line-claude start")


@app.command()
def start(
    tunnel: bool = typer.Option(True, help="Also start the Cloudflare tunnel"),
    claude_mode: bool = typer.Option(
        False, "--claude-mode", help="Enable CLAUDE_MODE (requires claude CLI on PATH)"
    ),
) -> None:
    """Start the bridge (and optionally the Cloudflare tunnel) in the background."""
    _ensure_state_dir()
    _env_path()

    if _read_pid(BRIDGE_PID):
        typer.echo("bridge is already running  (use 'line-claude status')")
        raise typer.Exit()

    log = LOG_FILE.open("a")
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    if claude_mode:
        env["CLAUDE_MODE"] = "true"

    bridge = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "line_claude_bridge:app",
         "--host", "0.0.0.0", "--port", "8000"],
        cwd=_HERE,
        stdout=log,
        stderr=log,
        env=env,
        start_new_session=True,
    )
    BRIDGE_PID.write_text(str(bridge.pid))
    typer.echo(f"  started bridge  (pid {bridge.pid})  →  {LOG_FILE}")

    if tunnel:
        token = _get_env("CLOUDFLARE_TUNNEL_TOKEN")
        if not token:
            typer.echo("  [warn] CLOUDFLARE_TUNNEL_TOKEN not set — skipping tunnel")
        else:
            try:
                tun = subprocess.Popen(
                    ["cloudflared", "tunnel", "--no-autoupdate",
                     "--protocol", "http2", "run", "--token", token],
                    cwd=_HERE,
                    stdout=log,
                    stderr=log,
                    start_new_session=True,
                )
                TUNNEL_PID.write_text(str(tun.pid))
                typer.echo(f"  started tunnel  (pid {tun.pid})")
            except FileNotFoundError:
                typer.echo("  [warn] cloudflared not found — skipping tunnel")
                typer.echo("         use Docker for the tunnel:  docker compose up tunnel -d")
                typer.echo("         or install cloudflared:     https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/")

    typer.echo("done.  Send a message in LINE to test.")


@app.command()
def stop() -> None:
    """Stop background bridge and tunnel processes."""
    stopped = False
    stopped |= _kill_pid(BRIDGE_PID, "bridge")
    stopped |= _kill_pid(TUNNEL_PID, "tunnel")
    if not stopped:
        typer.echo("nothing running")


@app.command()
def status() -> None:
    """Show whether bridge and tunnel are running."""
    bridge_pid = _read_pid(BRIDGE_PID)
    tunnel_pid = _read_pid(TUNNEL_PID)

    def _fmt(pid: int | None, name: str) -> str:
        if pid:
            return typer.style(f"  {name:<8} running  (pid {pid})", fg=typer.colors.GREEN)
        return typer.style(f"  {name:<8} stopped", fg=typer.colors.RED)

    typer.echo(_fmt(bridge_pid, "bridge"))
    typer.echo(_fmt(tunnel_pid, "tunnel"))

    if bridge_pid:
        typer.echo(f"\n  logs → {LOG_FILE}")
        typer.echo("  health check:")
        subprocess.run(["curl", "-sf", "http://localhost:8000/health"], check=False)
        typer.echo()


@app.command()
def logs(
    lines: int = typer.Option(50, "-n", help="Number of recent lines to show"),
    follow: bool = typer.Option(False, "-f", help="Follow log output"),
) -> None:
    """Tail the bridge log file."""
    if not LOG_FILE.exists():
        typer.echo(f"No log file yet at {LOG_FILE}")
        raise typer.Exit()
    cmd = ["tail", f"-n{lines}"]
    if follow:
        cmd.append("-f")
    cmd.append(str(LOG_FILE))
    subprocess.run(cmd)


@app.command()
def install() -> None:
    """Install as a systemd user service (auto-starts on login)."""
    _env_path()
    SYSTEMD_DIR.mkdir(parents=True, exist_ok=True)
    python = sys.executable
    cli = _HERE / "cli.py"
    unit = f"""[Unit]
Description=LINE-Claude bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={_HERE}
ExecStart={python} {cli} start --no-tunnel
ExecStop={python} {cli} stop
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
"""
    service_path = SYSTEMD_DIR / SERVICE_NAME
    service_path.write_text(unit)
    typer.echo(f"  wrote {service_path}")

    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", SERVICE_NAME], check=True)
    typer.echo(f"  enabled {SERVICE_NAME}")
    typer.echo("\nTo start now:   systemctl --user start line-claude-bridge")
    typer.echo("To check logs:  journalctl --user -u line-claude-bridge -f")


@app.command()
def uninstall() -> None:
    """Remove the systemd user service."""
    subprocess.run(
        ["systemctl", "--user", "disable", "--now", SERVICE_NAME],
        check=False,
    )
    service_path = SYSTEMD_DIR / SERVICE_NAME
    if service_path.exists():
        service_path.unlink()
        typer.echo(f"  removed {service_path}")
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=False)
    typer.echo("uninstalled.")


if __name__ == "__main__":
    app()
