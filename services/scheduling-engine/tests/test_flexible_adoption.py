import importlib.util
from pathlib import Path
import pytest

spec=importlib.util.spec_from_file_location('schedule_api',Path(__file__).resolve().parents[3]/'api'/'scheduling_engine.py')
api=importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
RUN='00000000-0000-0000-0000-000000000001'
PERIOD='00000000-0000-0000-0000-000000000002'
PREVIEW='00000000-0000-0000-0000-000000000003'


def test_fingerprint_ignores_queue_timestamps_but_not_policy_changes():
    assert api.context_fingerprint({'period':{'updated_at':'a','status':'drafting'}})==api.context_fingerprint({'period':{'updated_at':'b','status':'drafting'}})
    assert api.context_fingerprint({'target':2})!=api.context_fingerprint({'target':3})


@pytest.mark.parametrize('changed',[False,True])
def test_adoption_requires_unchanged_draft(monkeypatch,changed):
    context={'period':{'status':'drafting'}}
    baseline=[{'staff_id':'staff','shift_id':'shift','assignment_kind':'coverage'}]
    metadata={'preview_kind':'flexible','context_fingerprint':api.context_fingerprint(context),
        'comparison':{'standard_assignments':baseline},'preview_result':{'engine_version':api.ENGINE_VERSION,'draft_assignments':baseline,'generation_status':'generated',
        'validation':{'ready_for_commit':True,'errors':[],'warnings':[],'review_items':[]}}}
    writes=[]
    def request(path,token,data=None,method='GET'):
        if path=='/auth/v1/user': return {'id':'manager'}
        if '/profiles?' in path: return [{'app_role':'manager','is_active':True}]
        if 'get_schedule_planning_context' in path: return context
        if 'shift_assignments?' in path: return [] if changed else baseline
        if f'id=eq.{PREVIEW}' in path: return [{'metadata':metadata}]
        if 'save_generated_schedule_draft' in path: writes.append(data); return {}
        if method=='PATCH': return [{'metadata':{'availability_revision':1}}]
        raise AssertionError(path)
    monkeypatch.setattr(api,'supabase_request',request)
    body={'generation_run_id':RUN,'period_id':PERIOD,'mode':'adopt_flexible','preview_run_id':PREVIEW}
    if changed:
        with pytest.raises(ValueError,match='draft changed'): api.run_schedule(body,'Bearer test')
        assert not writes
    else:
        assert api.run_schedule(body,'Bearer test')['ok']
        assert writes[0]['p_assignments']==baseline
