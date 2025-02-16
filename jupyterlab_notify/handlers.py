from jupyter_server.base.handlers import JupyterHandler
from jupyter_server.extension.handler import ExtensionHandlerMixin
from http import HTTPStatus
import json
import logging
import tornado
# import json


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
        body = json.loads(self.request.body.decode('utf-8'))
        cell_id = body.get('cell_id',None)
        mode = body.get('mode',None)
        slack = body.get('slackEnabled',False)
        email = body.get('emailEnabled',False)
        success_message = body.get('successMessage')
        failure_message = body.get('failureMessage')
        threshold = body.get('threshold',None)
        
        if not cell_id:
            self.set_status(HTTPStatus.BAD_REQUEST)
            self.finish({"error": "Missing cell_id in request"})
            return
        
        self.logger.debug(f"Posting cell_id {cell_id}")
        self.extension_app.cell_ids[cell_id] = {
            'mode': mode,
            'slack': slack,
            'email': email,
            'success_msg': success_message,
            'failure_message': failure_message,
            'threshold': threshold
        }
        self.set_status(HTTPStatus.OK)
        self.finish({"accepted": True})

class NotifyTriggerHandler(ExtensionHandlerMixin, JupyterHandler):
    def initialize(self, extension_app, *args, **kwargs):
        self.extension_app = extension_app
        super().initialize(*args, **kwargs)

    @tornado.web.authenticated
    async def post(self):
        """Trigger notification directly"""
        data = self.get_json_body()
        cell_id = data.get("cell_id")
        mode = data.get("mode")
        slack = data.get("slackEnabled", False)
        email = data.get("emailEnabled", False)
        success = data.get("success")
        error = data.get("error", None)
        success_message = data.get('successMessage')
        failure_message = data.get('failureMessage')
        threshold = data.get('threshold',None)
        
        if not cell_id or not success:
            self.set_status(HTTPStatus.BAD_REQUEST)
            self.finish({"error": "Missing cell_id or success status in request"})
            return
        
        self.extension_app.send_notification(mode, cell_id, slack, email, success, success_message, failure_message, error)
        self.set_status(HTTPStatus.OK)
        self.finish({"done": True})
        