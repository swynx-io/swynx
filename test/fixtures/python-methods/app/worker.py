class Worker:
    def run(self):
        return self._live_helper()

    def _live_helper(self):
        return 42

    def _dead_helper(self):
        return 'never called'

    @property
    def _prop_helper(self):
        return 'properties are structural'
