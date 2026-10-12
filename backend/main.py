"""
main.py — FastAPI backend: Backhaul Load Marketplace + TMS API for the SMART API Agent

Run from the project root:
    uvicorn backend.main:app --reload --port 8000
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.models import MatchRequest, MatchResponse, BidResult
from backend.matching import eligibility_filter, net_value_rank
from backend.database import create_tables
from backend.tms import db as tms_db
from backend.tms.routes import router as tms_router, tools as agent_tools_router
from backend.tms.seed import reset_demo


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create marketplace tables; load the TMS demo data if it isn't there yet."""
    create_tables()
    first_run = not os.path.exists(tms_db.DB_PATH)
    if first_run or os.environ.get("TMS_RESET_ON_START", "false").lower() == "true":
        reset_demo()
    yield


app = FastAPI(title="TruckerPath Backend", version="1.1.0", lifespan=lifespan)

# CORS — which web pages may call this API from a browser.
# Comma-separated list in CORS_ORIGINS; the Vite dev server by default.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tms_router)
app.include_router(agent_tools_router)


@app.post("/marketplace/match", response_model=MatchResponse)
def match_backhaul(request: MatchRequest) -> MatchResponse:
    """
    Accept a backhaul opportunity payload, apply eligibility filter and net-value
    ranking, return structured result identical to the front-end localMatchCompute output.
    """
    eligible_bids: list[BidResult] = []
    ineligible_bids: list[BidResult] = []

    for bid in request.bids:
        result = eligibility_filter(bid, request)
        bid_result = BidResult(
            bid_id=bid.bid_id,
            carrier_name=bid.carrier_name,
            cargo_type=bid.cargo_type,
            cargo_weight_lbs=bid.cargo_weight_lbs,
            bid_price=bid.bid_price,
            detour_cost=bid.detour_cost,
            drop_stop_index=bid.drop_stop_index,
            eligibility_status=result["eligibility_status"],
            disqualify_reason=result["disqualify_reason"],
        )
        if result["eligibility_status"] == "eligible":
            eligible_bids.append(bid_result)
        else:
            ineligible_bids.append(bid_result)

    ranked = net_value_rank(eligible_bids)
    recommended_bid_id = ranked[0].bid_id if ranked else None

    return MatchResponse(
        eligible_bids=ranked,
        ineligible_bids=ineligible_bids,
        recommended_bid_id=recommended_bid_id,
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "backhaul-marketplace"}
