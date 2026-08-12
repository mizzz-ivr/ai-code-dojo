def classify_score(score: int) -> str:
    if score >= 80:
        return "A"
    if score >= 60:
        return "B"
    return "D"
