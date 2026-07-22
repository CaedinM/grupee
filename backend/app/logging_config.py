"""App-wide logger. Import `logger` from here everywhere — it is configured on
first import so module-level log calls (e.g. auth.py's startup warnings) work
without an explicit setup step. LOG_LEVEL env sets verbosity (default INFO);
DEBUG additionally shows the hot-path polling requests main.py demotes."""
import logging
import os

logger = logging.getLogger("wheretheyat")

if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-8s %(message)s", "%Y-%m-%d %H:%M:%S")
    )
    logger.addHandler(_handler)
    logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
    logger.propagate = False
