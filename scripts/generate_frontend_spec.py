"""Compatibility entrypoint; reviewed sources live in scripts/fe_parts, not a legacy template."""
from pathlib import Path
import subprocess

if __name__ == '__main__':
    subprocess.run(['node', str(Path(__file__).resolve().parent / 'combine_fe_spec.js')], check=True)
