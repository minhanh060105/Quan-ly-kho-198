#!/usr/bin/env python3
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parent
subprocess.run(['docker', 'compose', '-f', str(root/'compose.yaml'), '--env-file', str(root/'.env'), 'run', '--rm', '-T', 'shell', '--js', '--execute', (root/'bootstrap.js').read_text()], check=True)
