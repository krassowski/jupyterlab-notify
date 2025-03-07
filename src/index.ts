import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application';
import {
  INotebookTracker,
  NotebookActions,
  NotebookPanel,
} from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { LabIcon } from '@jupyterlab/ui-components';
import {
  createDefaultFactory,
  IToolbarWidgetRegistry,
  showErrorMessage,
} from '@jupyterlab/apputils';
import {
  bellOutlineIcon,
  bellFilledIcon,
  bellOffIcon,
  bellAlertIcon,
  bellClockIcon,
} from './icons';
import { requestAPI } from './handler';
import { Notification as JupyterNotification } from '@jupyterlab/apputils';
import { ICellModel } from '@jupyterlab/cells';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { MimeModel } from '@jupyterlab/rendermime';

namespace CommandIDs {
  export const toggleCellNotifications = 'toggle-cell-notifications';
}

const CELL_METADATA_KEY = 'jupyterlab_notify.notify';
const MIME_TYPE = 'application/desktop-notify+json';

// Interfaces
interface IMode {
  label: string;
  icon: LabIcon;
}

interface INotifySettings {
  defaultMode: ModeId;
  failureMessage: string;
  mail: boolean;
  slack: boolean;
  successMessage: string;
  threshold: number | null;
}

interface ICellMetadata {
  mode: ModeId;
}

interface IInitialResponse {
  nbmodel_installed: boolean;
  email_configured: boolean;
  slack_configured: boolean;
}

interface ICellNotification {
  payload: any;
  timeoutId: number | null;
  notificationIssued: boolean;
}

// Constants
const ModeIds = [
  'never',
  'always',
  'on-error',
  'global-timeout',
  'custom-timeout',
] as const;
type ModeId = (typeof ModeIds)[number];

const MODES: Record<ModeId, IMode> = {
  always: { label: 'Always', icon: bellFilledIcon },
  never: { label: 'Never', icon: bellOffIcon },
  'on-error': { label: 'On error', icon: bellAlertIcon },
  'global-timeout': {
    label: 'If longer than global timeout',
    icon: bellClockIcon,
  },
  'custom-timeout': { label: 'If longer than %1', icon: bellOutlineIcon }, //Todo: change icon
};

/**
 * Generates notification data with a custom message
 */
const generateNotificationData = (
  message: string,
  cell_id: string,
): Record<string, any> => ({
  type: 'NOTIFY',
  payload: {
    title: message,
    body: `Cell id: ${cell_id}`,
  },
  isProcessed: false,
  id: `notify-${Math.random().toString(36).substring(2)}`,
});

/**
 * Displays configuration warning for unconfigured services
 */
const displayConfigWarning = (
  service: 'Email' | 'Slack',
  configKey: string,
  example: string,
): void => {
  JupyterNotification.emit(`${service} Not Configured`, 'error', {
    autoClose: 3000,
    actions: [
      {
        label: 'Help',
        callback: () =>
          showErrorMessage(`${service} Not Configured`, {
            message: `Add a ${service.toLowerCase()} configuration to ~/.jupyter/jupyterlab_notify_config.json to enable ${service.toLowerCase()} notifications. Example: \n{\n  "${configKey}": "${example}"}-config"\n}`,
          }),
      },
    ],
  });
};

/**
 * Main plugin definition
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-notify:plugin',
  description: 'Enhanced cell execution notifications for JupyterLab',
  autoStart: true,
  requires: [INotebookTracker, IRenderMimeRegistry],
  optional: [IToolbarWidgetRegistry, ITranslator, ISettingRegistry],
  activate: async (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    rendermime: IRenderMimeRegistry,
    toolbarRegistry: IToolbarWidgetRegistry | null,
    translator: ITranslator | null,
    settingRegistry: ISettingRegistry | null,
  ) => {
    console.log('JupyterLab extension jupyterlab-notify is activated!');

    // Default settings
    let notifySettings: INotifySettings = {
      defaultMode: 'never',
      failureMessage: 'Cell execution failed',
      mail: false,
      slack: false,
      successMessage: 'Cell execution completed successfully',
      threshold: null,
    };

    // Settings management
    const updateSettings = (settings: ISettingRegistry.ISettings): void => {
      console.log('New Settings:', settings.composite);
      notifySettings = { ...notifySettings, ...settings.composite };
    };

    if (settingRegistry) {
      try {
        const settings = await settingRegistry.load(plugin.id);
        updateSettings(settings);
        settings.changed.connect(updateSettings);
      } catch (reason) {
        console.error('Failed to load settings for jupyterlab-notify:', reason);
      }
    }

    // Server configuration
    let config: IInitialResponse = {
      nbmodel_installed: false,
      email_configured: false,
      slack_configured: false,
    };

    try {
      config = await requestAPI<IInitialResponse>('notify');
    } catch (e) {
      console.error('Checking server capability failed:', e);
    }

    const cellNotificationMap: Map<string, ICellNotification> = new Map();

    // Cell metadata management
    const changeCellMetadata = (cell: ICellModel): void => {
      const oldMetadata = cell.getMetadata(CELL_METADATA_KEY) as
        | ICellMetadata
        | undefined;
      const oldModeId = oldMetadata?.mode;
      let nextModeIndex = oldModeId
        ? ModeIds.indexOf(oldModeId) + 1
        : ModeIds.indexOf(notifySettings.defaultMode);
      if (nextModeIndex >= ModeIds.length) nextModeIndex = 0;
      cell.setMetadata(CELL_METADATA_KEY, { mode: ModeIds[nextModeIndex] });
      app.commands.notifyCommandChanged(CommandIDs.toggleCellNotifications);
    };

    const addCellMetadata = (cell: ICellModel): void => {
      if (cell.getMetadata(CELL_METADATA_KEY)) return;
      cell.setMetadata(CELL_METADATA_KEY, { mode: notifySettings.defaultMode });
      app.commands.notifyCommandChanged(CommandIDs.toggleCellNotifications);
    };

    // Track new cells
    tracker.widgetAdded.connect((_, notebookPanel: NotebookPanel) => {
      const notebook = notebookPanel.content;
      notebook.model?.cells.changed.connect((_, change) => {
        if (change.type === 'add') {
          change.newValues.forEach(addCellMetadata);
        }
      });
    });

    /**
     * Handles notification rendering based on execution status
     */
    const handleNotification = async (
      cellId: string,
      success: boolean,
      threshold = false,
    ): Promise<void> => {
      const notification = cellNotificationMap.get(cellId);
      if (!notification || notification.notificationIssued) return;

      const { payload } = notification;
      if (payload.mode === 'on-error' && success && !threshold) return;

      // Determine appropriate message based on execution state
      const message = threshold
        ? 'Cell execution timeout reached'
        : success
        ? notifySettings.successMessage
        : notifySettings.failureMessage;

      const notificationData = generateNotificationData(message, cellId);

      if (!config.nbmodel_installed) {
        try {
          await requestAPI('notify-trigger', {
            method: 'POST',
            body: JSON.stringify({ ...payload, timer: threshold }),
          });
        } catch (e) {
          console.error('Failed to trigger notification:', e);
        }
      }

      try {
        const mimeModel = new MimeModel({
          data: { [MIME_TYPE]: notificationData },
        });
        const renderer = rendermime.createRenderer(MIME_TYPE);
        await renderer.renderModel(mimeModel);
        console.log('Notification rendered successfully');
        notification.notificationIssued = true;
      } catch (err) {
        console.error('Error rendering notification:', err);
      }

      if (notification.timeoutId) clearTimeout(notification.timeoutId);
      cellNotificationMap.delete(cellId);
    };

    // Execution listeners
    NotebookActions.executed.connect((_, args) => {
      handleNotification(args.cell.model.id, args.success);
    });

    NotebookActions.executionScheduled.connect(async (_, args) => {
      const { cell } = args;
      const cellMetadata = cell.model.getMetadata(
        CELL_METADATA_KEY,
      ) as ICellMetadata;
      const mode = cellMetadata?.mode;
      if (!mode || mode === 'never') return;

      if (Notification.permission != 'granted') {
        Notification.requestPermission().catch(err => {
          JupyterNotification.emit('Permission Error', 'error', {
            autoClose: 3000,
            actions: [
              {
                label: 'Show Details',
                callback: () =>
                  showErrorMessage('Permission Error', {
                    message: err,
                  }),
              },
            ],
          });
        });
      }
      // Show configuration warnings
      if (notifySettings.mail && !config.email_configured) {
        displayConfigWarning('Email', 'email', 'youremail@example.com');
      }
      if (notifySettings.slack && !config.slack_configured) {
        displayConfigWarning(
          'Slack',
          'slack_token',
          'xoxb-your-slackbot-token',
        );
      }

      const payload = {
        cell_id: cell.model.id,
        mode,
        emailEnabled: config.email_configured && notifySettings.mail,
        slackEnabled: config.slack_configured && notifySettings.slack,
        successMessage: notifySettings.successMessage,
        failureMessage: notifySettings.failureMessage,
        threshold: notifySettings.threshold,
      };

      const notification: ICellNotification = {
        payload,
        timeoutId: null,
        notificationIssued: false,
      };

      if (config.nbmodel_installed) {
        try {
          await requestAPI('notify', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        } catch (e) {
          console.error('Failed to notify server:', e);
        }
      }

      cellNotificationMap.set(cell.model.id, notification);

      if (payload.mode === 'global-timeout' && payload.threshold) {
        notification.timeoutId = setTimeout(() => {
          if (!notification.notificationIssued) {
            handleNotification(cell.model.id, true, true);
          }
        }, payload.threshold * 1000);
      }
    });

    // Command setup
    const trans = (translator ?? nullTranslator).load('jupyterlab-notify');
    app.commands.addCommand(CommandIDs.toggleCellNotifications, {
      label: args => {
        const current = tracker.currentWidget;
        if (!current) return trans.__('Toggle Notifications for Selected Cell');
        const selectedCells = current.content.selectedCells;
        if (selectedCells.length === 1) {
          const metadata = selectedCells[0].model.getMetadata(
            CELL_METADATA_KEY,
          ) as ICellMetadata | undefined;
          const modeId = metadata?.mode ?? notifySettings.defaultMode;
          return `${MODES[modeId].label} (click to toggle)`;
        }
        return trans._n(
          'Toggle Notifications for Selected Cell',
          'Toggle Notifications for %1 Selected Cells',
          selectedCells.length,
        );
      },
      execute: () => {
        const current = tracker.currentWidget;
        if (!current) return console.warn('No notebook selected');
        current.content.selectedCells.forEach(cell =>
          changeCellMetadata(cell.model),
        );
      },
      icon: args => {
        if (!args.toolbar || !tracker.currentWidget) return undefined;
        const cell = tracker.currentWidget.content.selectedCells[0];
        const metadata = cell.model.getMetadata(CELL_METADATA_KEY) as
          | ICellMetadata
          | undefined;
        const modeId = metadata?.mode ?? notifySettings.defaultMode;
        return MODES[modeId].icon;
      },
      isEnabled: args => (args.toolbar ? true : !!tracker.currentWidget),
    });

    // Toolbar integration
    if (toolbarRegistry) {
      const itemFactory = createDefaultFactory(app.commands);
      toolbarRegistry.addFactory('Cell', 'notify', widget =>
        itemFactory('Cell', widget, {
          name: 'notify',
          command: CommandIDs.toggleCellNotifications,
        }),
      );
    }
  },
};

export default plugin;
