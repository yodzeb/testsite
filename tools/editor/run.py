"""Lanceur de l'éditeur : prépare l'environnement Python (une seule fois),
démarre le serveur local et ouvre le navigateur.

    python tools/editor/run.py
"""
import hashlib
import os
import socket
import subprocess
import sys
import threading
import venv
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENV = HERE / ".venv"
REQS = HERE / "requirements.txt"


def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def free_port(start: int = 5173) -> int:
    for port in range(start, start + 50):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise SystemExit("Aucun port libre trouvé.")


def bootstrap() -> int:
    py = venv_python()
    if not py.exists():
        print("Première utilisation : préparation de l'environnement (1 à 2 minutes)…")
        venv.create(VENV, with_pip=True)
    marker = VENV / (".deps-" + hashlib.sha256(REQS.read_bytes()).hexdigest()[:12])
    if not marker.exists():
        print("Installation des composants nécessaires…")
        code = subprocess.call([str(py), "-m", "pip", "install", "--quiet", "-r", str(REQS)])
        if code != 0:
            print("L'installation a échoué : vérifiez la connexion Internet puis relancez.")
            return code
        marker.write_text("ok")
    return subprocess.call([str(py), str(Path(__file__).resolve())])


def serve() -> None:
    sys.path.insert(0, str(HERE))
    import app

    port = free_port()
    url = f"http://127.0.0.1:{port}/"
    threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    print(f"\nÉditeur ouvert sur {url}\nLaissez cette fenêtre ouverte ; fermez-la (ou Ctrl+C) pour quitter.\n")
    app.main(port)


if __name__ == "__main__":
    if sys.version_info < (3, 9):
        raise SystemExit("Python 3.9 ou plus récent est nécessaire (https://www.python.org/downloads/).")
    if Path(sys.prefix).resolve() == VENV.resolve():
        serve()
    else:
        raise SystemExit(bootstrap())
