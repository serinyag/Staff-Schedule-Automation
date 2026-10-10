from datetime import date
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock
import pytest
import app.runtime.worker as worker
from app.runtime.security import ENGINE_VERSION
from tests.test_validate_v1 import make_context, make_staff, make_shift, make_assignment, make_contract, STAFF_A, PERIOD_ID


def test_manual_draft_review_uses_manager_consecutive_rest_rule():
    manager=make_staff(STAFF_A);manager['scheduling_rule_role']='manager'
    shifts=[make_shift(f'rest-{d}',date(2026,7,d),'morning') for d in range(7,12)]
    context=make_context(staff=[manager],shifts=shifts,contracts=[make_contract(STAFF_A,min_shifts=5,target_shifts=5)])
    validation=worker.validation_for(context,[make_assignment(f'rest-{d}',STAFF_A) for d in range(7,12)])
    assert any(e['code']=='manager_consecutive_days_off_missing' for e in validation['errors'])


def test_validation_records_only_exact_server_snapshot_for_publication(monkeypatch):
    snapshot=dict(actor_id=STAFF_A,context=make_context(),assignments=[],mode='standard',input_hash='inputs',draft_hash='draft')
    user_db=SimpleNamespace(rpc=Mock(return_value=snapshot))
    db=SimpleNamespace(rpc=Mock(return_value={'ready':False}))
    result=worker.review_draft(PERIOD_ID,'Bearer user',publish=True,db=db,user_db=user_db)
    assert not result['ready']
    call=db.rpc.call_args
    assert call.args[0]=='record_schedule_validation'
    assert call.kwargs['p_input_hash']=='inputs' and call.kwargs['p_draft_hash']=='draft'
    assert call.kwargs['p_publish'] is True
    assert call.kwargs['p_validation']['errors']


def test_old_preview_is_rejected_without_saving(monkeypatch):
    db=SimpleNamespace(rpc=Mock(side_effect=[dict(state='claimed',lease_token='lease',period_id=PERIOD_ID,mode='adopt_flexible',attempt=1,
        context=make_context(),baseline=[],preview={'engine_version':'obsolete'}),{'state':'failed'}]))
    assert worker.process_run(PERIOD_ID,db)['state']=='failed'
    assert 'finish_schedule_job' not in [c.args[0] for c in db.rpc.call_args_list]
