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
        self.set_status(HTTPStatus.OK)
        self.finish({"nbmodel_installed": self.extension_app.is_listening})

    @tornado.web.authenticated
    async def post(self):
        """Register cell ID for notifications"""
        cell_id = json.loads(self.request.body.decode('utf-8')).get('cell_id',None)
        
        if not cell_id:
            self.set_status(HTTPStatus.BAD_REQUEST)
            self.finish({"error": "Missing cell_id in request"})
            return
        
        self.logger.debug(f"Posting cell_id {cell_id}")
        self.extension_app.cell_ids.add(cell_id)
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
        
        if not cell_id:
            self.set_status(HTTPStatus.BAD_REQUEST)
            self.finish({"error": "Missing cell_id in request"})
            return
        
        self.extension_app.send_notification(cell_id)
        self.set_status(HTTPStatus.OK)
        self.finish({"done": True})
        