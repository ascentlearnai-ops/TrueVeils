"""Calibrate Truveil's advisory transcript-risk model from consented labeled CSV data.

Input columns: text,label,transcript_confidence,duration_ms
label must be 0 (human/unassisted) or 1 (AI-assisted).
This script intentionally refuses to publish metrics for fewer than 500 samples.
"""

import argparse
import csv
import json
import math
import random
from pathlib import Path


def sigmoid(value):
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, value))))


def train(rows, feature_names, epochs=800, rate=0.08):
    weights = {name: 0.0 for name in feature_names}
    intercept = 0.0
    for _ in range(epochs):
        random.shuffle(rows)
        for row in rows:
            probability = sigmoid(intercept + sum(weights[name] * row[name] for name in feature_names))
            error = probability - row["label"]
            intercept -= rate * error
            for name in feature_names:
                weights[name] -= rate * (error * row[name] + 0.002 * weights[name])
    return intercept, weights


def metrics(rows, intercept, weights):
    buckets = []
    true_positive = false_positive = true_negative = false_negative = 0
    for row in rows:
        probability = sigmoid(intercept + sum(weights[name] * row[name] for name in weights))
        prediction = probability >= 0.58
        actual = bool(row["label"])
        true_positive += prediction and actual
        false_positive += prediction and not actual
        true_negative += not prediction and not actual
        false_negative += not prediction and actual
        buckets.append(abs(probability - row["label"]))
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "mean_absolute_calibration_error": round(sum(buckets) / max(1, len(buckets)), 4),
        "samples": len(rows),
        "confusion": {
            "true_positive": true_positive,
            "false_positive": false_positive,
            "true_negative": true_negative,
            "false_negative": false_negative,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, default=Path("risk-calibration-result.json"))
    args = parser.parse_args()

    with args.dataset.open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    if not rows:
        raise SystemExit("Dataset is empty.")

    excluded = {"text", "label", "transcript_confidence", "duration_ms"}
    feature_names = [name for name in rows[0] if name not in excluded]
    numeric_rows = [
        {**{name: float(row.get(name, 0) or 0) for name in feature_names}, "label": int(row["label"])}
        for row in rows
    ]
    random.Random(42).shuffle(numeric_rows)
    split = max(1, int(len(numeric_rows) * 0.8))
    train_rows, test_rows = numeric_rows[:split], numeric_rows[split:]
    intercept, weights = train(train_rows, feature_names)
    result = {
        "publishable": len(numeric_rows) >= 500,
        "warning": None if len(numeric_rows) >= 500 else "Fewer than 500 consented labeled responses; do not publish accuracy claims.",
        "intercept": intercept,
        "weights": weights,
        "held_out_metrics": metrics(test_rows, intercept, weights),
    }
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result["held_out_metrics"], indent=2))


if __name__ == "__main__":
    main()
