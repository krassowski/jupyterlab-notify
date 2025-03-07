import os
import json
from pathlib import Path
from traitlets.config import Configurable
from traitlets import Unicode, default, Any
from importlib import import_module
import inspect
from pydantic import BaseModel, Field
from typing import Optional
from threading import Timer


class NotificationParams(BaseModel):
    cell_id: str
    mode: str
    slack: bool = Field(alias="slackEnabled")
    email: bool = Field(alias="emailEnabled")
    success_message: str = Field(alias="successMessage")
    failure_message: str = Field(alias="failureMessage")
    threshold: int
    error: Optional[str] = Field(default=None)
    success: Optional[bool] = Field(default=False)
    timer: Optional[Timer] = Field(default=None)

    class Config:
        extra = "ignore"  # Ignores any extra fields in the request body
        arbitrary_types_allowed = True  # For allowing timer


class SMTPConfigurationError(Exception):
    pass


class NotificationConfig(Configurable):
    smtp_class: str = Unicode(
        "smtplib.SMTP",
        config=True,
        help="Fully qualified class name for the SMTP class to use",
    )

    smtp_args: str = Any(
        ["localhost", 1025],
        config=True,
        help="Arguments to pass to the SMTP class constructor, as a string",
    )

    email = Unicode(
        help="User's email for notifications", allow_none=True, default_value=None
    ).tag(config=True)

    slack_token = Unicode(
        help="Slack bot token for notifications", allow_none=True, default_value=None
    ).tag(config=True)

    slack_user_id = Unicode(
        help="Slack user ID for direct messages", allow_none=True, default_value=None
    ).tag(config=True)

    slack_channel_name = Unicode(
        help="Slack channel Name for notifications", allow_none=True, default_value=None
    ).tag(config=True)

    @default("email")
    def _email_default(self):
        return os.environ.get("JUPYTER_NOTIFY_EMAIL") or self._load_from_file("email")

    @default("slack_token")
    def _slack_token_default(self):
        return os.environ.get("JUPYTER_SLACK_TOKEN") or self._load_from_file(
            "slack_token"
        )

    @default("slack_user_id")
    def _slack_user_id_default(self):
        return os.environ.get("JUPYTER_SLACK_USER_ID") or self._load_from_file(
            "slack_user_id"
        )

    @default("slack_channel_name")
    def _slack_channel_id_default(self):
        return os.environ.get("JUPYTER_SLACK_CHANNEL_NAME") or self._load_from_file(
            "slack_channel_name"
        )

    def __init__(self):
        self.smtp_instance = None
        self._setup_smtp_instance()

    def _setup_smtp_instance(self):
        try:
            smtp_class = self._import_smtp_class()
            self._validate_smtp_class(smtp_class)
            self.smtp_instance = self._create_smtp_instance(smtp_class)
            self._validate_smtp_instance(self.smtp_instance)
        except SMTPConfigurationError as e:
            print(f"SMTP Configuration Error: {str(e)}")

    def _import_smtp_class(self):
        try:
            module_name, class_name = self.smtp_class.rsplit(".", 1)
        except ValueError:
            raise SMTPConfigurationError(
                f"Invalid smtp_class format: {self.smtp_class}. "
                "It should be in the format 'module.ClassName'."
            )

        try:
            module = import_module(module_name)
        except ImportError:
            raise SMTPConfigurationError(f"Could not import module: {module_name}")

        try:
            return getattr(module, class_name)
        except AttributeError:
            raise SMTPConfigurationError(
                f"Class {class_name} not found in module {module_name}"
            )

    def _validate_smtp_class(self, smtp_class):
        if not inspect.isclass(smtp_class):
            raise SMTPConfigurationError(f"{smtp_class.__name__} is not a class")

        if not hasattr(smtp_class, "send_message") or not callable(
            getattr(smtp_class, "send_message")
        ):
            raise SMTPConfigurationError(
                f"{smtp_class.__name__} does not have a callable 'send_message' method"
            )

    def _create_smtp_instance(self, smtp_class):
        args = self._process_smtp_args()

        try:
            if isinstance(args, dict):
                return smtp_class(**args)
            elif isinstance(args, (list, tuple)):
                return smtp_class(*args)
            else:
                return smtp_class()
        except Exception as e:
            raise SMTPConfigurationError(
                f"Failed to instantiate {smtp_class.__name__}: {str(e)}"
            )

    def _validate_smtp_instance(self, smtp_instance):
        if not hasattr(smtp_instance, "connect") or not callable(
            getattr(smtp_instance, "connect")
        ):
            raise SMTPConfigurationError(
                f"{type(smtp_instance).__name__} instance does not have a callable 'connect' method"
            )

    def _process_smtp_args(self):
        if self.smtp_args is None:
            return []

        if isinstance(self.smtp_args, str):
            try:
                import ast

                return ast.literal_eval(self.smtp_args)
            except:
                return self.smtp_args
        elif callable(self.smtp_args):
            return self.smtp_args()
        else:
            return self.smtp_args

    def _load_from_file(self, key):
        config_path = Path.home() / ".jupyter/jupyterlab_notify_config.json"
        try:
            with open(config_path, "r") as f:
                config = json.load(f)
                return config.get(key)
        except (FileNotFoundError, json.JSONDecodeError):
            return None
