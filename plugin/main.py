"""
main.py — the SMART API Agent plugin: a separate service next to the TMS.

Run from the project root (the TMS on port 8000 must be running):
    uvicorn plugin.main:app --reload --port 8100

Point the Qubi flows' base URL (TMS_URL in Qubi) at this service. It answers:
  /api/cases/...            cases Flow 1 works on (claim, messages, status)
  /api/agent-tools/...      the toolkit: checks and fixes
  /api/customer-requests    a customer asks for something → Flow 1
  /events/tms               the TMS reports a submitted order → review
  /api/detector/...         the detector's status, or run it now
  anything else under /api  passed through to the TMS unchanged
"""
import json
import secrets
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from plugin import cases, config, detector, dispatch, store, tms_client, toolkit
from plugin.auth import require_api_key


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.init()
    detector.start()
    yield
    detector.stop()


app = FastAPI(title="SMART API Agent plugin", version="1.0.0", lifespan=lifespan,
              description="Detector, customer requests, order events and the toolkit for the Qubi flows. "
                          "Talks to the TMS only through its normal API.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cases.requests_router)
app.include_router(cases.portal)
app.include_router(cases.cases)
app.include_router(toolkit.tools)
app.include_router(toolkit.orders)


# ── Order events from the TMS ────────────────────────────────────────

class TmsEvent(BaseModel):
    event: str
    sent_at: Optional[str] = None
    data: dict


def _on_order_submitted(order_id: str):
    case_id, created = cases.create_case(
        customer_code=None, shipment_id=None, order_id=order_id, channel="portal", category="new_order",
        message="New order submitted through the portal.")
    if created:
        dispatch.route("case.created", cases.get_case(case_id))


@app.post("/events/tms", status_code=202, tags=["Order events"],
          summary="Receives the TMS's events (order.submitted opens a review case)")
def tms_event(body: TmsEvent, background: BackgroundTasks,
              x_event_secret: Optional[str] = Header(None)):
    if config.TMS_EVENTS_SECRET and not secrets.compare_digest(x_event_secret or "", config.TMS_EVENTS_SECRET):
        raise HTTPException(401, "Missing or wrong X-Event-Secret header.")
    if body.event == "order.submitted":
        background.add_task(_on_order_submitted, body.data["order_id"])
        return {"accepted": True, "event": body.event, "order_id": body.data["order_id"]}
    return {"accepted": False, "event": body.event, "reason": "Not an event the plugin handles."}


# ── Detector ─────────────────────────────────────────────────────────

@app.get("/api/detector/status", tags=["Detector"], summary="Detector and notes watcher: settings and last runs")
def detector_status():
    return detector.status()


@app.post("/api/detector/run", tags=["Detector"], dependencies=[Depends(require_api_key)],
          summary="Run the detector now instead of waiting for the next minute")
def detector_run():
    return detector.run_detector()


@app.post("/api/detector/run-notes", tags=["Detector"], dependencies=[Depends(require_api_key)],
          summary="Run the notes watcher now instead of waiting for the next poll")
def notes_watcher_run():
    return {"handled": detector.run_notes_watcher()}


@app.get("/api/detector/problems", tags=["Detector"],
         summary="Problems already reported, and the case each one opened")
def detector_problems():
    conn = store.get_db()
    try:
        return store.rows(conn, "SELECT * FROM detected_problems ORDER BY first_seen DESC")
    finally:
        conn.close()


# ── Health and reset ─────────────────────────────────────────────────

@app.get("/health", tags=["Plugin"])
def health():
    try:
        tms_client.get("/api/meta/milestone-codes")
        tms = "ok"
    except HTTPException as e:
        tms = e.detail
    return {"status": "ok", "service": "smart-api-agent-plugin", "tms_url": config.TMS_URL, "tms": tms,
            "qubi_webhook": bool(config.QUBI_WEBHOOK_URL), "order_review": "plugin" if dispatch.orders_handled_by_plugin() else "qubi"}


@app.post("/api/admin/reset", tags=["Plugin"], dependencies=[Depends(require_api_key)],
          summary="Reset the TMS demo data and forget every case and detected problem")
def reset():
    tms = tms_client.write("POST", "/api/admin/reset")
    store.reset()
    cases._customer_cache.clear()
    store.kv_set("notes_cursor", str(tms_client.latest_note_id()))
    return {"tms": tms, "plugin": "cleared"}


# ── Everything else: straight through to the TMS ─────────────────────

# Writes that arrive through the plugin come from the agent, so their notes say so.
_AUTHORED = ("shipments", "orders", "notes")


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"], tags=["Pass-through"],
               summary="Any other TMS endpoint, forwarded unchanged")
async def passthrough(path: str, request: Request):
    content = await request.body()
    if request.method in ("POST", "PATCH", "PUT") and path.split("/")[0] in _AUTHORED and content:
        try:
            data = json.loads(content)
            if isinstance(data, dict):
                data.setdefault("author", config.AGENT_NAME)
                if path == "notes":
                    data.setdefault("author_type", "integration")
                content = json.dumps(data).encode()
        except ValueError:
            pass
    headers = {k: v for k, v in request.headers.items()
               if k.lower() in ("x-api-key", "content-type", "accept")}
    try:
        r = await run_in_threadpool(tms_client.raw, request.method, f"/api/{path}",
                                    params=request.query_params, headers=headers, content=content)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Can't reach the TMS at {config.TMS_URL}: {e}") from e
    return Response(content=r.content, status_code=r.status_code,
                    media_type=r.headers.get("content-type", "application/json"))
