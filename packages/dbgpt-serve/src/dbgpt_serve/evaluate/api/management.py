"""Dataset/run management used by the Evaluation UI, on evaluate_manage storage."""

import csv
import io
import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from dbgpt.core.interface.evaluation import ExactMatchMetric, metric_manage
from dbgpt_serve.agent.evaluation import evaluation_metric as _registered_metrics  # noqa: F401
from dbgpt_serve.core import Result
from ..models.models import ServeEntity


class DatasetInput(BaseModel):
    dataset_name: str = Field(min_length=1, max_length=256)
    content: str
    members: str = ""


class MemberInput(BaseModel):
    code: str
    members: str = ""


class RunInput(BaseModel):
    scene_key: str
    scene_value: str
    datasets: str
    evaluate_metrics: str | list[str]
    context: dict = Field(default_factory=dict)
    parallel_num: int = Field(default=1, ge=1)


def dataset_rows(content: str, filename: str = "dataset.json") -> list[dict]:
    try:
        if filename.lower().endswith(".csv"):
            rows = list(csv.DictReader(io.StringIO(content)))
        else:
            try:
                rows = json.loads(content)
            except json.JSONDecodeError:
                rows = [json.loads(line) for line in content.splitlines() if line.strip()]
        if not isinstance(rows, list) or not rows or any(
            not isinstance(row, dict) or not isinstance(row.get("query"), str) or not row["query"].strip()
            for row in rows
        ):
            raise ValueError("Each dataset row needs a non-empty query field.")
        return rows
    except (ValueError, TypeError) as error:
        raise HTTPException(422, "Use a non-empty JSON array, JSONL or CSV with a query field.") from error


def csv_response(rows: list[dict], filename: str):
    columns = list(dict.fromkeys(key for row in rows for key in row))
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()
    writer.writerows({key: json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
                     for key, value in row.items()} for row in rows)
    return Response(output.getvalue().encode("utf-8-sig"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'})


def management_router(get_service, check_api_key):
    metric_manage.metrics.setdefault(ExactMatchMetric.name(), ExactMatchMetric)
    router = APIRouter(dependencies=[Depends(check_api_key)])

    def owned(session, code, user, *, dataset=False):
        item = session.query(ServeEntity).filter(
            ServeEntity.evaluate_code == code, ServeEntity.user_id == user,
            ServeEntity.scene_key == "dataset" if dataset else ServeEntity.scene_key != "dataset",
        ).first()
        if item is None:
            raise HTTPException(404, "Evaluation dataset/run not found")
        return item

    def describe(item):
        dataset = item.scene_key == "dataset"
        return {
            "code": item.evaluate_code, "evaluate_code": item.evaluate_code,
            "name": item.datasets_name, "datasets_name": item.datasets_name,
            "scene_key": item.scene_key, "scene_value": item.scene_value,
            "state": item.state, "evaluate_metrics": item.evaluate_metrics,
            "storage_type": item.storage_type, "file_type": "json",
            "datasets_count": len(json.loads(item.datasets or "[]")) if dataset else None,
            "members": json.loads(item.context or "{}").get("members", "") if dataset else "",
            "average_score": item.average_score, "log_info": item.log_info,
            "gmt_create": item.gmt_create.isoformat() if item.gmt_create else None,
            "gmt_modified": item.gmt_modified.isoformat() if item.gmt_modified else None,
        }

    def create_dataset(service, data, user, filename="dataset.json"):
        rows = dataset_rows(data.content, filename)
        with service.dao.session() as session:
            item = ServeEntity(evaluate_code=uuid.uuid4().hex, scene_key="dataset",
                               datasets_name=data.dataset_name, datasets=json.dumps(rows, ensure_ascii=False),
                               context=json.dumps({"members": data.members}), storage_type="db",
                               user_id=user, state="ready")
            session.add(item)
            session.flush()
            return describe(item)

    @router.get("/storage/types")
    async def storage_types():
        # Uploaded files are parsed into DB rows; this does not promise OSS setup.
        return Result.succ([{"db": "Database JSON"}, {"file": "Upload file (database storage)"}])

    @router.post("/dataset/upload/content")
    async def upload_content(data: DatasetInput, service=Depends(get_service), user: str = Header(alias="user-id")):
        return Result.succ(create_dataset(service, data, user))

    @router.post("/dataset/upload/file")
    async def upload_file(dataset_name: str = Form(...), members: str = Form(""), doc_file: UploadFile = File(...),
                          service=Depends(get_service), user: str = Header(alias="user-id")):
        raw = await doc_file.read(10 * 1024 * 1024 + 1)
        if len(raw) > 10 * 1024 * 1024:
            raise HTTPException(413, "Dataset upload exceeds 10 MiB")
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise HTTPException(422, "Use a UTF-8 JSON, JSONL or CSV file") from error
        return Result.succ(create_dataset(service, DatasetInput(dataset_name=dataset_name, content=content, members=members), user, doc_file.filename or "dataset.json"))

    @router.get("/datasets")
    @router.get("/evaluations")
    async def list_items(request: Request,
                         page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=100),
                         service=Depends(get_service), user: str = Header(alias="user-id")):
        dataset = request.url.path.endswith("/datasets")
        with service.dao.session(commit=False) as session:
            query = session.query(ServeEntity).filter(ServeEntity.user_id == user,
                ServeEntity.scene_key == "dataset" if dataset else ServeEntity.scene_key != "dataset")
            total = query.count()
            items = query.order_by(ServeEntity.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
            return Result.succ({"items": [describe(item) for item in items], "total_count": total})

    @router.post("/dataset/members/update")
    async def update_members(data: MemberInput, service=Depends(get_service), user: str = Header(alias="user-id")):
        with service.dao.session() as session:
            item = owned(session, data.code, user, dataset=True)
            item.context = json.dumps({"members": data.members})
            return Result.succ(describe(item))

    @router.delete("/dataset")
    async def delete_dataset(code: str, service=Depends(get_service), user: str = Header(alias="user-id")):
        with service.dao.session() as session:
            session.delete(owned(session, code, user, dataset=True))
        return Result.succ(True)

    @router.delete("/evaluation")
    async def delete_evaluation(evaluation_code: str, service=Depends(get_service), user: str = Header(alias="user-id")):
        with service.dao.session() as session:
            item = owned(session, evaluation_code, user)
            if item.state == "running":
                raise HTTPException(409, "Evaluation is running")
            session.delete(item)
        return Result.succ(True)

    @router.get("/dataset/download")
    async def download_dataset(code: str, service=Depends(get_service), user: str = Header(alias="user-id")):
        with service.dao.session(commit=False) as session:
            rows = json.loads(owned(session, code, user, dataset=True).datasets)
        return csv_response(rows, "dataset")

    @router.get("/metrics")
    async def metrics(scene_key: str, scene_value: Optional[str] = None):
        return Result.succ([{"name": name, "describe": name} for name in metric_manage.metrics])

    @router.post("/start")
    async def start(data: RunInput, service=Depends(get_service), user: str = Header(alias="user-id")):
        if data.scene_key not in ("app", "recall"):
            raise HTTPException(422, "Select app or recall evaluation")
        metrics = [data.evaluate_metrics] if isinstance(data.evaluate_metrics, str) else data.evaluate_metrics
        if not metrics or any(name not in metric_manage.metrics for name in metrics):
            raise HTTPException(422, "Select registered evaluation metrics")
        with service.dao.session() as session:
            dataset = owned(session, data.datasets, user, dataset=True)
            rows = json.loads(dataset.datasets)
            item = ServeEntity(evaluate_code=uuid.uuid4().hex, scene_key=data.scene_key, scene_value=data.scene_value,
                               datasets_name=dataset.datasets_name, datasets=json.dumps(rows, ensure_ascii=False),
                               evaluate_metrics=json.dumps(metrics), context=json.dumps(data.context),
                               parallel_num=data.parallel_num, state="running", user_id=user, storage_type="db")
            session.add(item)
            session.flush()
            code = item.evaluate_code
        try:
            output = await service.run_evaluation(data.scene_key, data.scene_value, rows,
                context=data.context, evaluate_metrics=metrics, parallel_num=data.parallel_num)
            flattened = []
            for group in output:
                for result in (group if isinstance(group, list) else [group]):
                    flattened.append(result.model_dump() if hasattr(result, "model_dump") else result.dict() if hasattr(result, "dict") else result)
            if not flattened:
                raise ValueError("Evaluation produced no results")
            scores = {}
            for result in flattened:
                score = result.get("score")
                if isinstance(score, (int, float)):
                    scores.setdefault(result.get("metric_name") or "score", []).append(score)
            with service.dao.session() as session:
                item = owned(session, code, user)
                item.result = json.dumps(flattened, ensure_ascii=False, default=str)
                item.average_score = json.dumps({name: sum(values) / len(values) for name, values in scores.items()})
                item.state = "complete"
                response = describe(item)
            return Result.succ(response)
        except Exception as error:
            with service.dao.session() as session:
                item = owned(session, code, user)
                item.state = "failed"
                item.log_info = str(error)
            raise HTTPException(422, "Evaluation failed; inspect its saved run details") from error

    @router.get("/evaluation/detail/show")
    async def details(evaluate_code: str, service=Depends(get_service), user: str = Header(alias="user-id")):
        with service.dao.session(commit=False) as session:
            return Result.succ(json.loads(owned(session, evaluate_code, user).result or "[]"))

    @router.get("/evaluation/result/download")
    async def download_results(evaluate_code: str, service=Depends(get_service), user: str = Header(alias="user-id")):
        with service.dao.session(commit=False) as session:
            rows = json.loads(owned(session, evaluate_code, user).result or "[]")
        return csv_response(rows, "evaluation")

    return router
