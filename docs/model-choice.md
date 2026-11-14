# Local model choice

**Decision:** InterAct uses **Llama 3.1 8B** (`interact-llama3.1:8b`, 8K context) as its local model. It is the default `LLM_MODEL`. Qwen3 8B stays available for comparison.

Decided 2026-11-14, after the comparison below. Revisit it when the prompts change, when a hosted model is chosen for the demo (M9), or when the human-rated study (README section 8) can measure grading quality properly.

## Why Llama 3.1

| | Llama 3.1 8B | Qwen3 8B |
|---|---|---|
| Valid questions (type and difficulty as asked) | 10 / 10 | 10 / 10 |
| Questions in the requested style | 9 / 10 | 8 / 10 |
| Valid evaluations (parsed, exact rubric criteria) | **15 / 15** | **11 / 15** |
| Grades inside the hand-set band | **14 / 15** | 8 / 11 |
| Answers ranked strong > partial > weak > off-topic | every pair, all 3 questions | every valid pair, but no strong answer was ever graded |
| Evidence quotes found word for word in the answer | 27 / 27 | 35 / 35 |
| Off-topic answers flagged as insufficient evidence | 0 / 3 | 3 / 3 |
| Median time to write a question | 16 s | 84 s |
| Median time to grade an answer | 44 s | 64 s (up to 159 s) |

- **Reliability decides it.** Qwen3 failed on all three strong answers, the ones that matter most to get right: twice with invalid output, once with an Ollama server error. In the app a failure means a retry and a longer wait, and a student who wrote the best answer would be the one waiting.
- **Qwen3 over-scores partial answers.** It gave two one-line partial answers 80% and 70%, above the 20–60% band. Llama kept every partial answer at 40–60%.
- **Llama is several times faster** at writing questions (about 5x), largely because Qwen3 "thinks" before answering. Counting the question, its style check and the grade, a five-question interview costs Llama about 5½ minutes of model time and Qwen3 about 15.
- **Qwen3's one advantage is flagging off-topic answers**, which Llama never does. The app already covers that gap: since M2, an answer the model scores zero that shares no words with the question is flagged automatically, so Llama's grades get the same notice.

## What was compared

`research/experiments/compare_models.py` ran both models through the app's real prompts (question-v1, style-v1, evaluation-v1) and checks on the fixed dataset `research/datasets/model_comparison_v1.json`:

- **Questions:** 5 styles (direct, conceptual, case-based, scenario-based, application) for 2 topics, each checked for valid output and style.
- **Grading:** 3 questions (machine learning, databases, operating systems), each with a strong, partial, weak, off-topic and prompt-injection answer. The expected score band of every answer was written down before any model ran.

Each model got one try per item, to show its raw reliability. Full results, with every reply and timing:

- `research/experiments/results/model_comparison_20261113T180100Z.json` (the full run)
- `research/experiments/results/model_comparison_20261113T190238Z.json` (injection answers re-graded after the fix below)

## Prompt injection: a weakness found and fixed

The first run found that keeping answers inside data blocks was not enough. The scheduling injection answer was "Lower its priority." followed by a fake instruction to award full marks. Llama graded it 70% and Qwen3 60%, while Llama graded "Lower its priority." on its own at 30–40%.

The fix (commit "Remove text addressed to the grader before scoring") removes any sentence of an answer that both mentions scoring and gives an order, before the model sees it. Re-graded with the fix:

| Injection answer | Llama 3.1 before → after | Qwen3 before → after |
|---|---|---|
| Cross-validation | 10% → 30% | 30% → 30% |
| Database index | 0% → 40% | 30% → 30% |
| Scheduling | 70% → 40% | 60% → 30% |

The grades now match what each answer's genuine first sentence earns on its own, so the injection no longer helps. Two of Llama's grades are 40%, just above the 0–30% band written for these answers. That band assumed the injection answers had almost no real content, but "Add an index" and "Lower its priority" are correct partial answers, so partial credit is reasonable. The bands were not changed after seeing the results.

## Limits of this comparison

- **Small:** 10 questions and 15 graded answers, from one person's expected bands. It is enough to choose between two models for this project, not to claim grading accuracy. Score agreement with human raters is measured separately (README section 8).
- **One machine, under load:** both models ran on a 16 GB M4 Mac that was also running the frontend tests at the time, so every timing is slower than on an idle machine. The relative difference is what counts. Qwen3's one server error may also have come from that load.
- **One try per item:** in the app, invalid output gets a second try, so Qwen3's real failure rate would be lower but its waits longer.
- **Qwen3 ran with thinking on.** Turning it off would make it faster; that variant was not tested.
