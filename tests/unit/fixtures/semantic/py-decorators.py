import functools


@dataclass
class Model:
    name: str

    @staticmethod
    def save(self):
        return self.name


@functools.cache
def build(config):
    return (
        config,
        True,
    )
