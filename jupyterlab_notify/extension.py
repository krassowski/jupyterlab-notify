from jupyter_server.extension.application import ExtensionApp
from .handlers import NotifyHandler, NotifyTriggerHandler
import logging
from .config import NotificationConfig, NotificationParams
from email.message import EmailMessage
from typing import Dict, Optional

NBMODEL_SCHEMA_ID = "https://events.jupyter.org/jupyter_server_nbmodel/cell_execution/v1"

class NotifyExtension(ExtensionApp):
    name = "jupyter_notify_v2"

    def initialize(self):
        #setup config
        self.init_config()
        self.logger = logging.getLogger('jupyter-notify')
        self.logger.setLevel(logging.DEBUG)
        if not self.logger.hasHandlers():
            console_handler = logging.StreamHandler()  # Prints to console
            console_handler.setLevel(logging.DEBUG)  # Set handler's log level
            self.logger.addHandler(console_handler)  # Attach handler
        # Setup event listener if nbmodel is available
        try:
            from jupyter_server_nbmodel.event_logger import event_logger
            self.logger.debug("Adding event listener to server nbmodel")
            event_logger.add_listener(
                schema_id=NBMODEL_SCHEMA_ID,
                listener=self.event_listener
            )
            self.is_listening = True
        except ImportError:
            self.logger.debug("Failed to import jupyter_server_nbmodel")
            self.is_listening = False

        return super().initialize()

    def init_config(self):
        self._config = NotificationConfig()
        
        # Preinitialize attributes to default values
        self.slack_client = None
        self.slack_imported = False
        self.email = self._config.email
        self.slack_user_id = self._config.slack_user_id
        self.slack_channel_name = self._config.slack_channel_name  # Ensure this is defined in NotificationConfig

        try:
            import slack
            # Only attempt to create a client if a token is provided
            if self._config.slack_token:
                self.slack_client = slack.WebClient(token=self._config.slack_token)
            self.slack_imported = True
        except ImportError:
            self.slack_imported = False

    def initialize_handlers(self):
        self.cell_ids: Dict[str, NotificationParams] = {}
        self.handlers.extend([
            (r"/api/jupyter-notify/notify", NotifyHandler, {
                "extension_app": self
            }),
            (r"/api/jupyter-notify/notify-trigger", NotifyTriggerHandler, {
                "extension_app": self
            })
        ])
        

    async def event_listener(self, logger, schema_id: str, data: dict):
        """Handle execution_end events"""
        if data.get("event_type") != "execution_end":
            return        
        self.logger.debug(f"Got Event {data}")
        self.logger.debug(f"My cell_ids {self.cell_ids}")
        cell_id = data.get("cell_id")
        if cell_id and cell_id in self.cell_ids:
            cell = self.cell_ids.get(cell_id)
            cell.success = data.get('success')
            cell.error = data.get('kernel_error')
            self.logger.debug(f"Sending Notification-1: {cell}")
            self.send_notification(cell)
            self.cell_ids.remove(cell_id)
    def send_slack_notification(self, success: bool, success_msg: str, failure_msg: str, error: Optional[str]):
        self.logger.debug("Sending slack notification!")
        if self.slack_imported and self.slack_client:
            try:
                channel_name = '#' + self.slack_channel_name
                if self.slack_user_id:
                    try:
                        # Open a DM conversation with the user
                        response = self.slack_client.conversations_open(users=[self.slack_user_id])
                        # Extract the channel ID from the response
                        channel_name = response["channel"]["id"]
                    except Exception as e:
                        self.logger.error(f"Failed to open DM conversation: {e}")
                if channel_name:
                    message = f"Execution Status: {'Success' if success else 'Failure'}\n\nDetails:\n{success_msg if success else failure_msg}"
                    if error:
                        message += f"\n\nError:\n{error}"
                    self.slack_client.chat_postMessage(channel=channel_name, text=message)
            except Exception as e:
                self.logger.error(f"Failed to notify through slack: {e}")
    
    def send_email_notification(self, success: bool, success_msg: str, failure_msg: str, error: Optional[str]):
        self.logger.debug("Sending email notification")
        if not self.email:
            return
        message = EmailMessage()
        message["Subject"] = "Jupyter Cell Execution Status"
        message["From"] = self.email
        message["To"] = self.email
        status = "Success" if success else "Failure"
        body = f"Execution Status: {status}\n\nDetails:\n{success_msg if success else failure_msg}"
        if error:
            body += f"\n\nError:\n{error}"
        message.set_content(body)
        self._config.smtp_instance.send_message(message)
        # with smtplib.SMTP("localhost",1025) as smtp_conn:
        #     smtp_conn.send_message(message)

    def send_notification(self, params: NotificationParams):
        """Verify and send email or slack notification"""
        self.logger.debug(f"Sending notifications {params}")
        if params.mode == 'never':
            return
        if params.mode == 'on-error' and params.success:
            return
        if params.slack:
            self.send_slack_notification(params.success, params.success_message, params.failure_message, params.error)
        if params.email:
            self.send_email_notification(params.success, params.success_message, params.failure_message, params.error)
