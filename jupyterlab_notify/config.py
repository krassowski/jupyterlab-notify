import os
import json
from pathlib import Path
from traitlets.config import Configurable
from traitlets import Unicode, default

class NotificationConfig(Configurable):
    email = Unicode(
        help="User's email for notifications",
        allow_none=True,
        default_value=None
    ).tag(config=True)
    
    slack_token = Unicode(
        help="Slack bot token for notifications",
        allow_none=True,
        default_value=None
    ).tag(config=True)
    
    slack_user_id = Unicode(
        help="Slack user ID for direct messages",
        allow_none=True,
        default_value=None
    ).tag(config=True)
    
    slack_channel_name = Unicode(
        help="Slack channel Name for notifications",
        allow_none=True,
        default_value=None
    ).tag(config=True)
    
    @default('email')
    def _email_default(self):
        return os.environ.get('JUPYTER_NOTIFY_EMAIL') or self._load_from_file('email')
    
    @default('slack_token')
    def _slack_token_default(self):
        return os.environ.get('JUPYTER_SLACK_TOKEN') or self._load_from_file('slack_token')
    
    @default('slack_user_id')
    def _slack_user_id_default(self):
        return os.environ.get('JUPYTER_SLACK_USER_ID') or self._load_from_file('slack_user_id')
    
    @default('slack_channel_name')
    def _slack_channel_id_default(self):
        return os.environ.get('JUPYTER_SLACK_CHANNEL_NAME') or self._load_from_file('slack_channel_name')
    
    def _load_from_file(self, key):
        config_path = Path.home() / '.jupyter/jupyterlab_notify_config.json'
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
                return config.get(key)
        except (FileNotFoundError, json.JSONDecodeError):
            return None