#!/usr/bin/env python3
"""Entry point: python main.py  (or: python main.py -q "What is a tort?")"""

import sys

from legal_bot.cli import main

if __name__ == "__main__":
    sys.exit(main())
