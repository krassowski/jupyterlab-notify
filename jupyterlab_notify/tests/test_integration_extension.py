import json
import pytest
from unittest.mock import MagicMock
from jupyterlab_notify import extension
from jupyterlab_notify.config import NotificationParams
from pathlib import Path


@pytest.fixture
def dummy_config_file(tmp_path, monkeypatch):
    # Set up a fake home directory with a .jupyter folder
    fake_home = tmp_path
    jupyter_dir = fake_home / ".jupyter"
    jupyter_dir.mkdir()

    # Create the dummy config file in the .jupyter folder
    dummy_file = jupyter_dir / "jupyterlab_notify_config.json"
    config_data = {
        "email": "test@example.com",
        "slack_token": "xoxb-dummy-slack-token",
        "slack_user_id": "U12345678",
        "slack_channel_name": "general",
    }
    dummy_file.write_text(json.dumps(config_data))

    # Patch Path.home() to return our fake home directory
    monkeypatch.setattr(Path, "home", lambda: fake_home)
    return config_data


@pytest.fixture
def notify_extension(dummy_config_file):
    ext = extension.NotifyExtension()
    ext._init_config()
    ext._init_logging()

    dummy_smtp = MagicMock()
    dummy_smtp.send_message = MagicMock()
    ext._config.smtp_instance = dummy_smtp

    dummy_slack_client = MagicMock()
    dummy_slack_client.conversations_open.return_value = {
        "channel": {"id": "D12345678"}
    }
    ext.slack_client = dummy_slack_client
    ext.slack_imported = True
    return ext


def test_end_to_end_notification(notify_extension):
    """
    Integration test that calls send_notification and checks that both
    slack and email notifications are dispatched end-to-end.
    """
    params = NotificationParams(
        cell_id="cell_integration",
        mode="always",
        slackEnabled=True,
        emailEnabled=True,
        successMessage="Integration Success",
        failureMessage="Integration Failure",
        threshold=5,
        success=True,
    )
    # For this test, we do not override send_slack_notification and send_email_notification.
    notify_extension.send_notification(params)

    # Verify that the dummy SMTP's send_message was called.
    notify_extension._config.smtp_instance.send_message.assert_called_once()

    # Verify that slack methods were called.
    notify_extension.slack_client.conversations_open.assert_called_once_with(
        users=[notify_extension._config.slack_user_id]
    )
    notify_extension.slack_client.chat_postMessage.assert_called_once()
