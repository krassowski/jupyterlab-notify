import logging
from email.message import EmailMessage
from typing import Dict, Any

from jupyter_server.extension.application import ExtensionApp
from .handlers import NotifyHandler, NotifyTriggerHandler
from .config import NotificationConfig, NotificationParams

NBMODEL_SCHEMA_ID = "https://events.jupyter.org/jupyter_server_nbmodel/cell_execution/v1"


class NotifyExtension(ExtensionApp):
    name = "jupyter_notify_v2"

    def initialize(self) -> None:
        """Initialize extension, configuration, logging, and event listeners."""
        self._init_config()
        self._init_logging()
        self._init_nbmodel_listener()
        super().initialize()

    def _init_logging(self) -> None:
        """Setup logging for the extension."""
        self.logger = logging.getLogger('jupyter-notify')
        self.logger.setLevel(logging.DEBUG)
        if not self.logger.hasHandlers():
            console_handler = logging.StreamHandler()
            console_handler.setLevel(logging.DEBUG)
            self.logger.addHandler(console_handler)

    def _init_config(self) -> None:
        """Initialize and set up the notification configuration."""
        self._config = NotificationConfig()
        self.slack_client = None
        self.slack_imported = False

        # Initialize email and Slack configuration
        self.email = self._config.email
        self.slack_user_id = self._config.slack_user_id
        self.slack_channel_name = self._config.slack_channel_name

        try:
            import slack  # type: ignore
            if self._config.slack_token:
                self.slack_client = slack.WebClient(token=self._config.slack_token)
            self.slack_imported = True
        except ImportError:
            self.slack_imported = False

    def _init_nbmodel_listener(self) -> None:
        """Initialize event listener if jupyter_server_nbmodel is available."""
        try:
            from jupyter_server_nbmodel.event_logger import event_logger
            self.logger.debug("Registering event listener for nbmodel events.")
            event_logger.add_listener(
                schema_id=NBMODEL_SCHEMA_ID,
                listener=self.event_listener
            )
            self.is_listening = True
        except ImportError:
            self.logger.debug("jupyter_server_nbmodel not available; skipping event listener.")
            self.is_listening = False

    def initialize_handlers(self) -> None:
        """Register API handlers for notification endpoints."""
        self.cell_ids: Dict[str, NotificationParams] = {}
        self.handlers.extend([
            (r"/api/jupyter-notify/notify", NotifyHandler, {"extension_app": self}),
            (r"/api/jupyter-notify/notify-trigger", NotifyTriggerHandler, {"extension_app": self})
        ])

    async def event_listener(self, logger: Any, schema_id: str, data: dict) -> None:
        """
        Listen to cell execution events and send notifications upon completion.

        Args:
            logger: The event logger.
            schema_id: The event schema identifier.
            data: The event data.
        """
        if data.get("event_type") != "execution_end":
            return

        self.logger.debug(f"Received event: {data}")
        cell_id = data.get("cell_id")
        if cell_id and cell_id in self.cell_ids:
            params = self.cell_ids[cell_id]
            if params.timer:
                params.timer.cancel()
            params.success = data.get('success')
            params.error = data.get('kernel_error')
            self.logger.debug(f"Notifying for cell_id {cell_id}: {params}")
            self.send_notification(params)
            # Remove cell record after notification is sent.
            del self.cell_ids[cell_id]

    def send_slack_notification(self, message_content: str) -> None:
        """
        Send a Slack notification if configuration and dependencies allow it.

        Args:
            message_content: The content to send in the Slack message.
        """
        self.logger.debug("Attempting to send Slack notification.")
        if not (self.slack_imported and self.slack_client):
            self.logger.error("Slack library not imported or client not initialized.")
            return

        channel = f"#{self.slack_channel_name}"
        # If a specific Slack user is set, try opening a DM channel.
        if self.slack_user_id:
            try:
                response = self.slack_client.conversations_open(users=[self.slack_user_id])
                channel = response["channel"]["id"]
            except Exception as exc:
                self.logger.error(f"Failed to open DM conversation: {exc}")

        try:
            self.slack_client.chat_postMessage(channel=channel, text=message_content)
        except Exception as exc:
            self.logger.error(f"Error sending Slack notification: {exc}")

    def send_email_notification(self, message_content: str) -> None:
        """
        Send an email notification if email is configured.

        Args:
            message_content: The content to include in the email.
        """
        self.logger.debug("Attempting to send email notification.")
        if not self.email:
            self.logger.error("Email is not configured; skipping email notification.")
            return

        email_message = EmailMessage()
        email_message["Subject"] = "Jupyter Cell Execution Status"
        email_message["From"] = self.email
        email_message["To"] = self.email
        email_message.set_content(message_content)

        try:
            self._config.smtp_instance.send_message(email_message)
        except Exception as exc:
            self.logger.error(f"Error sending email notification: {exc}")

    def send_notification(self, params: NotificationParams) -> None:
        """
        Prepare and dispatch notifications based on the parameters.

        Args:
            params: Notification parameters including mode, messages, and status.
        """
        self.logger.debug(f"Preparing to send notification with params: {params}")

        # Determine status and message based on cell execution
        if params.timer and params.timer.is_alive():
            params.timer.cancel()
            status = "Timeout"
            message = "Cell execution timed out!"
        else:
            status = "Success" if params.success else "Failed"
            message = params.success_message if params.success else params.failure_message
            if not params.success and params.error:
                message += f"\nError:\n{params.error}"

        # Decide whether to send the notification based on mode
        if params.mode == 'never' or (params.mode == 'on-error' and params.success):
            self.logger.debug("Notification mode conditions not met; skipping notification.")
            return

        formatted_message = f"Execution Status: {status}\nCell id: {params.cell_id}\nDetails: {message}"
        self.logger.debug(f"Formatted notification message: {formatted_message}")

        if params.slack:
            self.send_slack_notification(formatted_message)
        if params.email:
            self.send_email_notification(formatted_message)
