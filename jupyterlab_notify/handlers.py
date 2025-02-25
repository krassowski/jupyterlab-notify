from jupyter_server.base.handlers import JupyterHandler
from jupyter_server.extension.handler import ExtensionHandlerMixin
from http import HTTPStatus
import json
import logging
import tornado
from .config import NotificationParams


class NotifyHandler(ExtensionHandlerMixin, JupyterHandler):
    def initialize(self, extension_app, *args, **kwargs):
        self.logger = logging.getLogger('jupyter-notify')
        self.logger.setLevel(logging.DEBUG)
        if not self.logger.hasHandlers():
            console_handler = logging.StreamHandler()  # Prints to console
            console_handler.setLevel(logging.DEBUG)  # Set handler's log level
            self.logger.addHandler(console_handler)  # Attach handler
        self.extension_app = extension_app
        super().initialize(*args, **kwargs)

    @tornado.web.authenticated
    def get(self):
        """Check if extension is listening events from jupyter-server-nbmodel"""
        self.logger.debug(f"Checking for nbmodel! {self.extension_app.is_listening}")

        verifySlack = bool(self.extension_app.slack_client and (self.extension_app.slack_user_id or self.extension_app.slack_channel_name))
        verifyEmail = bool(self.extension_app.email)
        self.set_status(HTTPStatus.OK)
        self.finish({"nbmodel_installed": self.extension_app.is_listening, "slack_configured": verifySlack, "email_configured": verifyEmail})

    @tornado.web.authenticated
    async def post(self):
        """Register cell ID for notifications"""
        try:
            body = json.loads(self.request.body)
            print("\nSlack and email",body.get("slackEnabled"),body.get("emailEnabled"),"\n")
            params = NotificationParams(**body)  # Pydantic will validate
        except json.JSONDecodeError:
            self.set_status(HTTPStatus.BAD_REQUEST)
            self.finish({"error": "Invalid JSON in request"})
            return
        except ValueError as e:
            self.set_status(HTTPStatus.BAD_REQUEST)
            self.finish({"error": str(e)})
            return
        
        self.logger.debug(f"Posting cell_id {params.cell_id}")
        self.extension_app.cell_ids[params.cell_id] = params
        self.set_status(HTTPStatus.OK)
        self.finish({"accepted": True})

class NotifyTriggerHandler(ExtensionHandlerMixin, JupyterHandler):
    def initialize(self, extension_app, *args, **kwargs):
        self.extension_app = extension_app
        super().initialize(*args, **kwargs)

    @tornado.web.authenticated
    async def post(self):
        """Trigger notification directly"""
        try:
            body = json.loads(self.request.body)
            params = NotificationParams(**body)  # Pydantic will validate
        except json.JSONDecodeError:
            self.set_status(HTTPStatus.BAD_REQUEST)
            self.finish({"error": "Invalid JSON in request"})
            return
        except ValueError as e: 
            self.set_status(HTTPStatus.BAD_REQUEST)
            self.finish({"error": str(e)})
            return
        
        self.extension_app.send_notification(params)
        self.set_status(HTTPStatus.OK)
        self.finish({"done": True})
        