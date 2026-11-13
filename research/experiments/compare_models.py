"""Compare candidate LLMs on InterAct's own tasks, using the app's real prompts and checks.

Run from backend/ so the app's settings and packages are used:

    .venv/bin/python ../research/experiments/compare_models.py \\
        --models interact-llama3.1:8b interact-qwen3:8b

Each model gets exactly one try per item, so the results show its raw
reliability; in the app, invalid output is retried. Results are written to
research/experiments/results/ as JSON and summarised on screen.
"""

import argparse
import json
import statistics
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.llm import LLMError  # noqa: E402
from app.core.openai_compatible import OpenAICompatibleLLM  # noqa: E402
from app.models.enums import Difficulty, QuestionType  # noqa: E402
from app.schemas import AnswerEvaluation, GeneratedQuestion, InterviewConfig, InterviewContext, StyleVerdict  # noqa: E402
from app.services import prompts  # noqa: E402
from app.services.evidence import quote_in_answer, remove_grader_instructions  # noqa: E402
from app.services.question_styles import MIX_ORDER, style_rule_problem  # noqa: E402
from app.services.rubrics import rubric_for  # noqa: E402

DATASET = ROOT / "research" / "datasets" / "model_comparison_v1.json"
RESULTS = ROOT / "research" / "experiments" / "results"
QUALITY_ORDER = ["strong", "partial", "weak", "off-topic"]


def timed(llm, request):
    started = time.monotonic()
    try:
        return llm.complete(request).text, time.monotonic() - started, None
    except LLMError as error:
        return None, time.monotonic() - started, str(error)


def run_generation(llm, dataset):
    rows = []
    for item in dataset["generation"]:
        context = InterviewContext.model_validate({"input_model": "TOPIC", **{k: item[k] for k in ("topic", "goal", "subtopics")}})
        config = InterviewConfig.model_validate({"question_type": "MIXED", "difficulty": item["difficulty"], "question_count": 5})
        previous = []
        for sequence, question_type in enumerate(MIX_ORDER, start=1):
            competency = item["subtopics"][(sequence - 1) % len(item["subtopics"])]
            request = prompts.question_request(context=context, config=config, sequence=sequence, question_type=question_type, competency=competency, previous_prompts=previous)
            text, seconds, error = timed(llm, request)
            row = {"topic": item["topic"], "requested": question_type.value, "seconds": round(seconds, 1), "valid": False, "error": error}
            if text is not None:
                try:
                    question = GeneratedQuestion.model_validate_json(text)
                    row.update(valid=question.type is question_type and question.difficulty.value == item["difficulty"], prompt=question.prompt)
                except ValueError as invalid:
                    row["error"] = str(invalid).splitlines()[0]
            if row["valid"]:
                previous.append(row["prompt"])
                row["rule_problem"] = style_rule_problem(question_type, row["prompt"])
                verdict_text, verdict_seconds, _ = timed(llm, prompts.style_check_request(question_prompt=row["prompt"], requested=question_type))
                row["style_check_seconds"] = round(verdict_seconds, 1)
                try:
                    row["llm_style"] = StyleVerdict.model_validate_json(verdict_text).style.value if verdict_text else None
                except ValueError:
                    row["llm_style"] = None
                row["style_passed"] = row["rule_problem"] is None and row["llm_style"] in (question_type.value, None)
            rows.append(row)
            print(f"  generate {question_type.value:<14} {row['seconds']:6.1f}s valid={row['valid']} style={row.get('style_passed')}", flush=True)
    return rows


def run_grading(llm, dataset, qualities=None):
    rows = []
    for item in dataset["grading"]:
        question_type = QuestionType(item["question_type"])
        rubric = rubric_for(question_type)
        criteria = rubric.criteria_json()
        for answer in item["answers"]:
            if qualities and answer["quality"] not in qualities:
                continue
            # Graded exactly as the app grades: text aimed at the grader is removed first.
            graded_text, _ = remove_grader_instructions(answer["text"])
            request = prompts.evaluation_request(
                question_prompt=item["question"], question_type=question_type, difficulty=Difficulty(item["difficulty"]),
                competency=item["competency"], answer=graded_text, criteria=criteria)
            text, seconds, error = timed(llm, request)
            row = {"question": item["id"], "quality": answer["quality"], "seconds": round(seconds, 1), "valid": False, "error": error}
            if text is not None:
                try:
                    evaluation = AnswerEvaluation.model_validate_json(text)
                    matches = {(c.name, c.max_score) for c in evaluation.criteria} == {(c["name"], c["max_score"]) for c in criteria}
                    if not matches:
                        raise ValueError("criteria do not match the rubric")
                    quotes = [c.evidence_quote for c in evaluation.criteria if c.evidence_quote]
                    low, high = answer["expected_percent"]
                    percent = round(100 * evaluation.score / evaluation.max_score)
                    row.update(
                        valid=True, percent=percent, in_band=low <= percent <= high,
                        insufficient=evaluation.insufficient_evidence,
                        quotes=len(quotes), quotes_verified=sum(quote_in_answer(q, answer["text"]) for q in quotes),
                        outline_points=len(evaluation.better_answer_outline),
                    )
                    if answer.get("expect_insufficient"):
                        row["flag_correct"] = evaluation.insufficient_evidence
                except ValueError as invalid:
                    row["error"] = str(invalid).splitlines()[0]
            rows.append(row)
            print(f"  grade {item['id']:<9} {answer['quality']:<9} {row['seconds']:6.1f}s valid={row['valid']} percent={row.get('percent')}", flush=True)
    return rows


def ranking_agreement(grading):
    """Share of answer pairs within a question whose order matches strong > partial > weak > off-topic."""
    agree = total = 0
    for question in {row["question"] for row in grading}:
        scored = {r["quality"]: r["percent"] for r in grading if r["question"] == question and r["valid"]}
        for i, better in enumerate(QUALITY_ORDER):
            for worse in QUALITY_ORDER[i + 1:]:
                if better in scored and worse in scored:
                    total += 1
                    agree += scored[better] > scored[worse] or (scored[better] == scored[worse] == 0 and worse != "partial")
    return agree / total if total else None


def rate(values):
    values = list(values)
    return round(sum(values) / len(values), 3) if values else None


def summarise(model, generation, grading):
    valid_grades = [r for r in grading if r["valid"]]
    seconds = [r["seconds"] for r in generation + grading]
    return {
        "model": model,
        "question_valid_rate": rate(r["valid"] for r in generation),
        "style_pass_rate": rate(r.get("style_passed", False) for r in generation),
        "evaluation_valid_rate": rate(r["valid"] for r in grading),
        "score_in_expected_band_rate": rate(r["in_band"] for r in valid_grades),
        "ranking_agreement": ranking_agreement(grading),
        "off_topic_flag_rate": rate(r["flag_correct"] for r in valid_grades if "flag_correct" in r),
        "injection_resisted_rate": rate(r["in_band"] for r in valid_grades if r["quality"] == "injection"),
        "quote_verified_rate": rate(
            q for r in valid_grades for q in [True] * r["quotes_verified"] + [False] * (r["quotes"] - r["quotes_verified"])),
        "median_seconds_per_call": round(statistics.median(seconds), 1) if seconds else None,
        "max_seconds_per_call": max(seconds) if seconds else None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--models", nargs="+", required=True)
    parser.add_argument("--base-url", default="http://localhost:11434/v1")
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--skip-generation", action="store_true", help="only grade answers")
    parser.add_argument("--qualities", nargs="+", help="only grade answers of these qualities, e.g. injection")
    args = parser.parse_args()

    dataset = json.loads(DATASET.read_text())
    report = {
        "dataset": dataset["name"],
        "prompt_versions": prompts.PROMPT_VERSIONS,
        "started_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "options": {"skip_generation": args.skip_generation, "qualities": args.qualities},
        "models": [],
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"model_comparison_{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.json"
    for model in args.models:
        print(f"\n== {model}", flush=True)
        llm = OpenAICompatibleLLM(base_url=args.base_url, model=model, timeout_seconds=args.timeout, max_retries=1)
        generation = [] if args.skip_generation else run_generation(llm, dataset)
        grading = run_grading(llm, dataset, args.qualities)
        report["models"].append({"summary": summarise(model, generation, grading), "generation": generation, "grading": grading})
        out.write_text(json.dumps(report, indent=2))  # Saved after each model, so a long run is never lost.

    print(f"\nResults: {out}")
    for entry in report["models"]:
        print(json.dumps(entry["summary"], indent=2))


if __name__ == "__main__":
    main()
