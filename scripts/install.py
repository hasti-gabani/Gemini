#!/usr/bin/env python3
"""Install everything (same as `python scripts/runner.py install`)."""
import os
import subprocess
import sys

runner = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'runner.py')
sys.exit(subprocess.call([sys.executable, runner, 'install', *sys.argv[1:]]))
