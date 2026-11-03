from dbgpt_serve.datasource.service.service import _preserve_private_parameters, _public_parameters


def test_public_datasource_parameters_remove_nested_secrets():
    value = {"database": "analytics", "password": "p", "options": {
        "api_key": "k", "token": "t", "region": "r",
    }}
    assert _public_parameters(value) == {"database": "analytics", "options": {"region": "r"}}


def test_edit_keeps_omitted_secrets_and_accepts_replacement():
    existing = {"database": "analytics", "password": "p", "options": {"token": "t", "region": "r"}}
    edit = {"database": "analytics", "password": "", "options": {"region": "new"}}
    assert _preserve_private_parameters(edit, existing) == {
        "database": "analytics", "password": "p", "options": {"token": "t", "region": "new"},
    }
    assert _preserve_private_parameters({"password": "new"}, existing)["password"] == "new"
