"""Runtime failures never turn a partially saved draft into a failed run."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock
import pytest
import app.runtime.worker as worker
from app.runtime.database import DatabaseError, log_event
from app.runtime.security import worker_signature, verify_worker, ENGINE_VERSION
from tests.test_validate_v1 import make_context, PERIOD_ID

RUN = '11111111-1111-4111-8111-111111111111'
LEASE = '22222222-2222-4222-8222-222222222222'


def job(**extra):
    return dict(state='claimed',lease_token=LEASE,period_id=PERIOD_ID,mode='standard',attempt=1,
                context=make_context(),baseline=[],**extra)


def install_result(monkeypatch):
    result = {'engine_version':ENGINE_VERSION,'draft_assignments':[], 'validation':{'errors':[]}}
    monkeypatch.setattr(worker,'generate_schedule',lambda *a,**k:SimpleNamespace(response=SimpleNamespace(model_dump=lambda **k:deepcopy(result))))
    monkeypatch.setattr(worker,'validation_for',lambda *a,**k:{'errors':[]})


def test_completed_duplicate_and_active_lease_never_run_solver(monkeypatch):
    solver=Mock();monkeypatch.setattr(worker,'generate_schedule',solver)
    for state,expected in [('done',True),('failed',True),('busy',False)]:
        db=SimpleNamespace(rpc=Mock(return_value={'state':state}))
        assert worker.process_run(RUN,db)['ok']==expected
    solver.assert_not_called()


def test_result_and_completion_have_one_atomic_write(monkeypatch):
    install_result(monkeypatch)
    db=SimpleNamespace(rpc=Mock(side_effect=[job(),{'state':'completed'}]))
    assert worker.process_run(RUN,db)['ok']
    assert [c.args[0] for c in db.rpc.call_args_list]==['claim_schedule_job','finish_schedule_job']
    assert db.rpc.call_args_list[1].kwargs['p_lease_token']==LEASE


def test_transient_database_failure_requests_safe_retry(monkeypatch):
    install_result(monkeypatch)
    db=SimpleNamespace(rpc=Mock(side_effect=[job(),DatabaseError(503),{'state':'retry'}]))
    assert worker.process_run(RUN,db)=={'ok':False,'state':'retry'}
    assert db.rpc.call_args_list[-1].kwargs['p_retryable'] is True


def test_stale_save_conflict_is_terminal_not_retried(monkeypatch):
    install_result(monkeypatch)
    db=SimpleNamespace(rpc=Mock(side_effect=[job(),DatabaseError(400,'P0001'),{'state':'failed'}]))
    assert worker.process_run(RUN,db)['state']=='failed'
    assert db.rpc.call_args_list[-1].kwargs['p_retryable'] is False


def test_failure_recording_does_not_mask_original_failure(monkeypatch):
    install_result(monkeypatch)
    original=DatabaseError(503)
    db=SimpleNamespace(rpc=Mock(side_effect=[job(),original,ValueError('secondary')]))
    with pytest.raises(DatabaseError) as e:worker.process_run(RUN,db)
    assert e.value is original


def test_worker_signature_is_fresh_and_bound_to_exact_body(monkeypatch):
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY','test-secret')
    body=b'{"run_id":"a"}';signature=worker_signature(body,1000)
    assert verify_worker(body,'1000',signature,now=1001)
    assert not verify_worker(body,'1000',signature,now=1091)
    assert not verify_worker(b'{"run_id":"b"}','1000',signature,now=1001)
    assert not verify_worker(body,'bad',signature,now=1001)


def test_structured_logs_do_not_include_credentials_or_inputs(caplog):
    log_event('failure',run_id=RUN,token='private',planning_context={'email':'private'},error_type='DatabaseError')
    assert RUN in caplog.text and 'private' not in caplog.text
