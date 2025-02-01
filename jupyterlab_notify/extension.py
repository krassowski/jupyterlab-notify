from jupyter_server.extension.application import ExtensionApp
from .handlers import NotifyHandler, NotifyTriggerHandler
import logging

NBMODEL_SCHEMA_ID = "https://events.jupyter.org/jupyter_server_nbmodel/cell_execution/v1"

class NotifyExtension(ExtensionApp):
    name = "jupyter_notify_v2"
    # TODO Configuration parameters for email

    def initialize(self):
        # Setup event listener if nbmodel is available
        self.logger = logging.getLogger('jupyter-notify')
        self.logger.setLevel(logging.DEBUG)
        if not self.logger.hasHandlers():
            console_handler = logging.StreamHandler()  # Prints to console
            console_handler.setLevel(logging.DEBUG)  # Set handler's log level
            self.logger.addHandler(console_handler)  # Attach handler
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

    def initialize_handlers(self):
        self.cell_ids = set()
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
            self.send_notification(cell_id)
            self.cell_ids.remove(cell_id)

    def send_notification(self, cell_id: str):
        """Send email notification (Function X)"""
        print("Sending an email!")

