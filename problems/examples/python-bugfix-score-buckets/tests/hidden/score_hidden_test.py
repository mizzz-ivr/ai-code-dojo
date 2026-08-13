import importlib.util
from pathlib import Path
import unittest


def load_submission():
    source = Path(__file__).resolve().parents[2] / "starter" / "score.py"
    spec = importlib.util.spec_from_file_location("submission_score_hidden", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ScoreHiddenTest(unittest.TestCase):
    def test_boundary_values(self):
        module = load_submission()
        cases = {
            0: "D",
            59: "D",
            60: "C",
            79: "C",
            80: "B",
            89: "B",
            90: "A",
            100: "A",
        }
        for score, expected in cases.items():
            with self.subTest(score=score):
                self.assertEqual(module.classify_score(score), expected)

    def test_rejects_out_of_range_scores(self):
        module = load_submission()
        for score in (-1, 101):
            with self.subTest(score=score):
                with self.assertRaises(ValueError):
                    module.classify_score(score)


if __name__ == "__main__":
    unittest.main()
