# blender_bridge.py — Bridge between Python/MCP and Blender 5.x
# Project: Cartoon Maker AI (animasi2d)

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from typing import Dict, Any, Optional, Tuple

DEFAULT_HOST = "localhost"
DEFAULT_PORT = 9876
# Video rendering can take much longer than a still preview.
# Override with BLENDER_MCP_TIMEOUT (seconds) when needed.
DEFAULT_TIMEOUT = float(os.environ.get("BLENDER_MCP_TIMEOUT", "7200"))
BLENDER_EXE = os.environ.get(
    "BLENDER_EXE",
    r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
)

def is_blender_mcp_running(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> bool:
    """Check if Blender MCP socket server is listening."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(1.0)
            sock.connect((host, port))
            return True
    except (ConnectionRefusedError, socket.timeout, OSError):
        return False

def send_to_mcp(code: str, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, timeout: float = DEFAULT_TIMEOUT) -> Dict[str, Any]:
    """
    Send Python code directly to Blender MCP socket server.
    Expected protocol: JSON null-delimited.
    """
    payload = json.dumps({
        "type": "execute",
        "code": code,
        "strict_json": False,
    }) + "\0"

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        sock.connect((host, port))
        sock.sendall(payload.encode("utf-8"))

        buf = bytearray()
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            idx = chunk.find(b"\0")
            if idx != -1:
                buf.extend(chunk[:idx])
                break
            buf.extend(chunk)

    if not buf:
        raise ConnectionError("Empty response received from Blender MCP server.")

    try:
        return json.loads(buf.decode("utf-8"))
    except Exception as e:
        return {"status": "error", "message": f"Failed to parse JSON response: {e}", "raw": buf.decode("utf-8", errors="replace")}

# Long frame-by-frame renders may exceed several hours. Set BLENDER_CLI_TIMEOUT
# to a positive number to enforce a limit; 0 (default) disables the CLI timeout.
CLI_TIMEOUT = float(os.environ.get("BLENDER_CLI_TIMEOUT", "0"))

def run_blender_cli(code: str, blend_file: Optional[str] = None, timeout: float = CLI_TIMEOUT) -> Dict[str, Any]:
    """Execute Python code in headless Blender background mode."""
    if not os.path.exists(BLENDER_EXE):
        raise FileNotFoundError(f"Blender executable not found at: {BLENDER_EXE}")

    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(code)
        script_path = f.name

    cmd = [BLENDER_EXE, "--background"]
    if blend_file and os.path.exists(blend_file):
        cmd.append(blend_file)
    cmd.extend(["--python", script_path])

    try:
        # Stream Blender output live so frame-by-frame progress is visible in the
        # user's terminal instead of being hidden until subprocess.run completes.
        import queue
        import threading

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        output_lines = []
        output_queue = queue.Queue()

        def _read_output():
            try:
                for _line in proc.stdout:
                    output_queue.put(_line)
            finally:
                output_queue.put(None)

        reader = threading.Thread(target=_read_output, daemon=True)
        reader.start()
        started_at = time.monotonic()
        stream_closed = False

        while True:
            try:
                item = output_queue.get(timeout=0.2)
                if item is None:
                    stream_closed = True
                else:
                    output_lines.append(item)
                    print(item, end="", flush=True)
            except queue.Empty:
                pass

            if stream_closed and proc.poll() is not None:
                break

            if timeout > 0 and time.monotonic() - started_at > timeout and proc.poll() is None:
                proc.kill()
                proc.wait()
                raise subprocess.TimeoutExpired(
                    cmd, timeout, output="".join(output_lines)
                )

        return_code = proc.wait()
        output_text = "".join(output_lines)
        return {
            "status": "ok" if return_code == 0 else "error",
            "returncode": return_code,
            "stdout": output_text,
            "stderr": "",
        }
    finally:
        if os.path.exists(script_path):
            try:
                os.remove(script_path)
            except OSError:
                pass

def execute_blender_code(code: str, fallback_cli: bool = True, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> Dict[str, Any]:
    """
    Execute Blender Python code. Tries Blender MCP socket first if running;
    falls back to background Blender CLI if fallback_cli is True.
    """
    if is_blender_mcp_running(host, port):
        print(f"[*] Connected to active Blender MCP server on {host}:{port}")
        # Never launch a second Blender process when an MCP request fails or times out:
        # the original render may still be running inside the interactive Blender.
        # A blind CLI fallback can duplicate a long render and exhaust CPU/GPU/RAM.
        return send_to_mcp(code, host=host, port=port)
    elif fallback_cli:
        print("[*] Blender MCP socket not detected. Executing via Blender Background CLI...")
        return run_blender_cli(code)
    else:
        return {
            "status": "error",
            "message": f"Blender MCP socket not listening on {host}:{port} and fallback CLI disabled."
        }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Blender Bridge for animasi2d")
    parser.add_argument("--check", action="store_true", help="Check if Blender MCP socket is online")
    parser.add_argument("--file", type=str, help="Python script file to execute in Blender")
    parser.add_argument("--cli-only", action="store_true", help="Force CLI background execution")
    args = parser.parse_args()

    if args.check:
        online = is_blender_mcp_running()
        print(f"Blender MCP Status: {'ONLINE (:9876)' if online else 'OFFLINE'}")
        sys.exit(0 if online else 1)

    if args.file:
        if not os.path.exists(args.file):
            print(f"Error: file '{args.file}' not found.")
            sys.exit(1)
        with open(args.file, "r", encoding="utf-8") as f:
            code = f.read()
        res = execute_blender_code(code, fallback_cli=True)
        print("Status:", res.get("status"))
        if res.get("stdout"):
            print("STDOUT:\n", res.get("stdout")[-1000:])
        if res.get("stderr"):
            print("STDERR:\n", res.get("stderr")[-1000:])
        if res.get("message"):
            print("Message:", res.get("message"))

