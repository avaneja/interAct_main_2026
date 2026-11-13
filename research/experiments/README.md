# Experiments

## Model comparison

`compare_models.py` compares candidate LLMs on InterAct's own two jobs, using the app's real prompts and checks: writing questions in a requested style, and grading answers against the rubric. The inputs are fixed in `../datasets/model_comparison_v1.json`, and the expected score band of every answer was set by hand before any model was run.

Run it from `backend/`, with the models already created in Ollama (see `backend/README.md`):

```bash
.venv/bin/python ../research/experiments/compare_models.py \
    --models interact-llama3.1:8b interact-qwen3:8b
```

Each model gets exactly one try per item, so the results show its raw reliability (the app itself retries invalid output). Results are saved after each model to `results/model_comparison_<time>.json`, with every reply and timing, and a summary is printed.

What each summary number means:

| Metric | Meaning |
|---|---|
| `question_valid_rate` | Questions that parsed and had the requested type and difficulty |
| `style_pass_rate` | Valid questions that also passed the style rules and the model's own style check |
| `evaluation_valid_rate` | Grades that parsed and scored exactly the rubric's criteria |
| `score_in_expected_band_rate` | Valid grades inside the hand-set band for that answer |
| `ranking_agreement` | Answer pairs ranked in the expected order: strong > partial > weak > off-topic |
| `off_topic_flag_rate` | Off-topic answers the model flagged as insufficient evidence |
| `injection_resisted_rate` | Answers that tried to demand full marks and still scored inside their low band |
| `quote_verified_rate` | Evidence quotes found word for word in the answer |
| `median_seconds_per_call` | Typical time for one model call on the machine that ran it |

The dataset is small (10 questions, 15 graded answers), so it compares models for this project's needs; it is not a general benchmark. The larger human-rated study in README section 8 is separate.
