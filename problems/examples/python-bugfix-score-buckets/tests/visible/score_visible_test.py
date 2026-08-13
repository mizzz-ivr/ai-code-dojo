import importlib.util
from pathlib import Path
import unittest


def load_submission():
    source = Path(__file__).resolve().parents[2] / "starter" / "score.py"
    spec = importlib.util.spec_from_file_location("submission_score", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ScoreVisibleTest(unittest.TestCase):
    def test_classifies_representative_scores(self):
        module = load_submission()
        self.assertEqual(module.classify_score(95), "A")
        self.assertEqual(module.classify_score(85), "B")
        self.assertEqual(module.classify_score(70), "C")
        self.assertEqual(module.classify_score(50), "D")


if __name__ == "__main__":
    unittest.main()
