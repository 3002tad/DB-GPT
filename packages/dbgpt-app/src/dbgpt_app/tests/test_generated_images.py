import asyncio
import json
from contextlib import contextmanager
from unittest.mock import patch

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from dbgpt_app.openapi.api_v1.generated_images import (
    history_has_image, link_published_images, owner_history_has_image,
    register_images, resolve_image,
)
from dbgpt_app.pipeline_identity import PipelineActor, PipelineIdentityMiddleware
from dbgpt_app.pipeline_authorization import authorize_pipeline_request


def stored_image(url, *, user_prose=False):
    payload = {"type": "react-agent", "generated_images": [url], "steps": []}
    return json.dumps({"type": "human" if user_prose else "view",
                       "data": {"content": url if user_prose else json.dumps(payload)}})


def test_old_native_history_recovers_only_structured_images():
    assert history_has_image(stored_image('/images/a.png'), '/images/a.png')
    assert not history_has_image(stored_image('/images/a.png', user_prose=True), '/images/a.png')
    assert not history_has_image(stored_image('/images/ab.png'), '/images/a.png')
    assert not history_has_image('{bad', '/images/a.png')


def test_history_query_enforces_owner_and_escaped_name():
    from dbgpt.storage.chat_history.chat_history_db import ChatHistoryEntity, ChatHistoryMessageEntity
    engine = create_engine('sqlite://')
    ChatHistoryEntity.__table__.create(engine)
    ChatHistoryMessageEntity.__table__.create(engine)
    with Session(engine) as session:
        session.add(ChatHistoryEntity(conv_uid='c1', user_name='alice', chat_mode='chat_react_agent', summary='test'))
        session.add(ChatHistoryMessageEntity(conv_uid='c1', index=1, round_index=1,
            message_detail=stored_image('/images/test_chart.png')))
        session.commit()

    class Dao:
        @contextmanager
        def session(self, **kwargs):
            with Session(engine) as session:
                yield session

    with patch('dbgpt.storage.metadata.BaseDao', Dao):
        assert owner_history_has_image('alice', 'test_chart.png')
        assert not owner_history_has_image('bob', 'test_chart.png')
        assert not owner_history_has_image('alice', 'testXchart.png')


def test_live_index_old_history_and_path_boundaries(tmp_path):
    (tmp_path / 'one.png').write_bytes(b'PNG')
    register_images(tmp_path, ['/images/one.png'], 'alice')
    assert resolve_image(tmp_path, 'one.png', 'alice') == tmp_path / 'one.png'
    register_images(tmp_path, ['/images/one.png'], 'bob')
    with pytest.raises(FileNotFoundError):
        resolve_image(tmp_path, 'one.png', 'bob')
    (tmp_path / 'old.png').write_bytes(b'PNG')
    assert resolve_image(tmp_path, 'old.png', 'alice', lambda owner, name: owner == 'alice')
    for name in ('../secret.png', '.owners/one.png.json', 'one.png/extra', 'one.html'):
        with pytest.raises(FileNotFoundError):
            resolve_image(tmp_path, name, 'alice', lambda *_: True)
    with pytest.raises(FileNotFoundError):
        resolve_image(tmp_path, 'one.png', None)
    (tmp_path / 'abc_xu_hướng.png').write_bytes(b'PNG')
    register_images(tmp_path, ['/images/abc_xu_hướng.png'], 'alice')
    assert resolve_image(tmp_path, 'abc_xu_hướng.png', 'alice').is_file()


def test_published_urls_only_replace_unique_inline_paths_not_code_or_guesses():
    urls = ['/images/abc_chart.png']
    assert link_published_images('Chart: `plots/chart.png`', urls) == 'Chart: ![Biểu đồ](/images/abc_chart.png)'
    code = '```python\nx = "`plots/chart.png`"\n```\n'
    assert link_published_images(code, urls) == code
    assert link_published_images('`plots/missing.png`', urls) == '`plots/missing.png`'
    assert link_published_images('`plots/chart.png`', urls + ['/images/def_chart.png']) == '`plots/chart.png`'


@pytest.mark.parametrize('role', ['analyst', 'super_admin'])
def test_legacy_image_url_uses_authentication_and_owned_handler(role):
    class Verifier:
        async def verify(self, authorization):
            assert authorization == 'Bearer good'
            return PipelineActor(id='alice', role=role)

    async def app(scope, receive, send):
        assert scope['path'] == '/api/v1/chat/generated-image/one.png'
        assert scope['state']['pipeline_actor'].id == 'alice'
        await send({'type': 'http.response.start', 'status': 200, 'headers': [(b'content-type', b'image/png')]})
        await send({'type': 'http.response.body', 'body': b'PNG'})

    middleware = PipelineIdentityMiddleware(app, verifier=Verifier(), policy=authorize_pipeline_request)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=middleware), base_url='https://ai.test') as client:
            assert (await client.get('/images/one.png')).status_code == 401
            result = await client.get('/images/one.png', headers={'Authorization': 'Bearer good'})
            assert result.status_code == 200 and result.content == b'PNG'
            result = await client.get('/images/one.png', headers={'Cookie': '__Host-funnelmetry-ai=good'})
            assert result.status_code == 200
            assert (await client.post('/images/one.png')).status_code == 403
            assert (await client.get('/images/secret.json')).status_code == 403
    asyncio.run(run())


def test_actual_image_endpoint_keeps_owner_and_private_response_headers(tmp_path):
    import ast
    from pathlib import Path
    from fastapi import FastAPI, Depends, HTTPException
    from starlette.concurrency import run_in_threadpool
    from dbgpt_serve.utils.auth import UserRequest, get_user_from_headers

    source = Path(__file__).parents[1] / 'openapi/api_v1/agentic_data_api.py'
    function = next(n for n in ast.parse(source.read_text(encoding='utf-8')).body
                    if isinstance(n, ast.AsyncFunctionDef) and n.name == 'generated_chat_image')
    function.decorator_list = []
    namespace = dict(Depends=Depends, HTTPException=HTTPException, UserRequest=UserRequest,
                     get_user_from_headers=get_user_from_headers, run_in_threadpool=run_in_threadpool,
                     __name__='dbgpt_app.openapi.api_v1.agentic_data_api',
                     __package__='dbgpt_app.openapi.api_v1')
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
    app = FastAPI()
    app.add_api_route('/api/v1/chat/generated-image/{name}', namespace['generated_chat_image'], methods=['GET', 'HEAD'])
    file = tmp_path / 'one.png'
    file.write_bytes(b'\x89PNG\r\n\x1a\n')

    def lookup(root, name, owner):
        if owner != 'alice' or name != 'one.png':
            raise FileNotFoundError()
        return file

    class Verifier:
        async def verify(self, authorization):
            return PipelineActor(id=authorization.split()[-1], role='analyst')

    middleware = PipelineIdentityMiddleware(app, verifier=Verifier(), policy=authorize_pipeline_request)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=middleware), base_url='https://ai.test') as client:
            with patch('dbgpt_app.openapi.api_v1.generated_images.resolve_image', lookup):
                r = await client.get('/images/one.png', headers={'Authorization': 'Bearer alice'})
                assert r.status_code == 200 and r.headers['content-type'] == 'image/png'
                assert r.headers['cache-control'] == 'private, no-store'
                assert 'sandbox' in r.headers['content-security-policy']
                assert (await client.head('/images/one.png', headers={'Authorization': 'Bearer alice'})).content == b''
                assert (await client.get('/images/one.png', headers={'Authorization': 'Bearer bob'})).status_code == 404
    asyncio.run(run())
