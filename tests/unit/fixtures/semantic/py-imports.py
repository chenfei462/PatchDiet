import sys
from os.path import (
    join,
    exists,
)


def entry(config):
    return join(config, sys.platform)
