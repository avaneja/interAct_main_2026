"""M9: BM25 retrieval over a document's chunks, and the small-document shortcut."""

import json
from dataclasses import dataclass

from sqlalchemy import select

from app.core.llm import FakeLLM
from app.core.storage import FileStorage
from app.models import Base, DocumentChunk, DocumentTopic, User
from app.models.enums import AuthProvider
from app.services import documents
from app.services.retrieval import bm25, source_passages, strong_matches, terms


@dataclass(eq=False)
class Passage:
    text: str


SPLITS = Passage("Data is split into training, validation and test sets. The test set is used once at the end.")
FOLDS = Passage("In k-fold cross-validation the data is divided into folds and each fold is held out once.")
METRICS = Passage("Precision and recall describe positive predictions. The F1 score combines precision and recall.")
THRESHOLD = Passage("Lowering the decision threshold raises recall and lowers precision.")
ALL = [SPLITS, FOLDS, METRICS, THRESHOLD]


def test_terms_drop_stopwords_and_plural_s():
    assert terms("The folds of the data are held out") == ["fold", "data", "held", "out"]
    assert terms("loss class") == ["loss", "class"]


def test_bm25_ranks_the_passage_about_the_query_first():
    assert bm25("cross-validation folds", ALL)[0][0] is FOLDS
    assert bm25("precision recall F1", ALL)[0][0] is METRICS


def test_rare_words_weigh_more_than_common_ones():
    ranked = bm25("F1 precision", ALL)
    assert ranked[0][0] is METRICS
    assert ranked[0][1] > ranked[1][1]


def test_strong_matches_need_a_real_match():
    assert strong_matches("k-fold cross-validation", ALL) == [FOLDS]
    assert strong_matches("convolutional neural networks", ALL) == []


def test_a_small_document_is_used_whole():
    assert source_passages("folds", mapped=[FOLDS], everything=ALL, budget_tokens=10_000) == ALL


def test_a_large_document_uses_the_topics_mapped_chunks_within_the_budget():
    chosen = source_passages("precision recall", mapped=[METRICS, THRESHOLD], everything=ALL, budget_tokens=25)
    assert chosen == [METRICS]


def test_without_mapped_chunks_the_best_matches_are_used_in_document_order():
    chosen = source_passages("precision recall threshold", mapped=[], everything=ALL, budget_tokens=40)
    assert chosen == [METRICS, THRESHOLD]


def test_one_passage_is_returned_even_over_the_budget():
    assert source_passages("folds", mapped=[FOLDS], everything=ALL, budget_tokens=1) == [FOLDS]


def test_a_topic_with_invented_chunk_ids_is_found_by_its_words(db_engine, db_session, tmp_path):
    Base.metadata.create_all(db_engine)
    user = User(auth_provider=AuthProvider.GOOGLE, provider_user_id="1", display_name="Ada")
    db_session.add(user)
    db_session.commit()
    storage = FileStorage(tmp_path)
    filler = "Training a model means fitting its parameters to examples. " * 60
    text = (filler + "Cross-validation splits the data into folds; every fold is held out once. " * 40 + filler)
    document = documents.upload(db_session, user, storage, "notes.txt", text.encode(), 10 * 2**20)
    llm = FakeLLM()
    llm.queue_for("map_topics", json.dumps({"summary": "Notes.", "topics": [
        {"name": "Cross-validation folds", "summary": "Holding out each fold once.", "chunk_ids": ["c77"]},
        {"name": "Quantum computing", "summary": "Qubits.", "chunk_ids": ["c78"]}]}))

    documents.process(db_session, document, storage, llm)

    topic = db_session.scalar(select(DocumentTopic))
    chunks = {str(c.id): c for c in db_session.scalars(select(DocumentChunk))}
    assert topic.name == "Cross-validation folds"
    assert topic.chunk_ids and all("fold" in chunks[i].text for i in topic.chunk_ids)
    assert db_session.scalars(select(DocumentTopic)).all() == [topic]
