"""Compatibility entrypoint. Canonical sources now live in scripts/contract_parts.
Do not restore historical embedded templates: they overwrite reviewed revisions.
"""
from pathlib import Path
import subprocess

if __name__ == '__main__':
    subprocess.run(['node', str(Path(__file__).resolve().parents[1] / 'combine_contract.js')], check=True)
