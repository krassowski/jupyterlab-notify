import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { LabIcon } from '@jupyterlab/ui-components';
import {
  createDefaultFactory,
  IToolbarWidgetRegistry,
  showErrorMessage,
} from '@jupyterlab/apputils';
import { bellOutlineIcon, bellFilledIcon, bellOffIcon, bellAlertIcon, bellClockIcon } from './icons';
import { requestAPI } from './handler';
import { Notification } from '@jupyterlab/apputils';

namespace CommandIDs {
  export const toggleCellNotifications = 'toggle-cell-notifications';
}

const CELL_METADATA_KEY = 'jupyterlab_notify.notify';


interface IMode {
  label: string;
  icon: LabIcon;
}

const ModeIds = ['always', 'never', 'on-error', 'global-timeout', 'custom-timeout'] as const;
type ModeId = typeof ModeIds[number];

const MODES: Record<ModeId, IMode> = {
  'always': {
    label: 'Always',
    icon: bellFilledIcon
  },
  'never': {
    label: 'Never',
    icon: bellOffIcon
  },
  'on-error': {
    label: 'On error',
    icon: bellAlertIcon
  },
  'global-timeout': {
    label: 'If longer than global timeout',
    icon: bellOutlineIcon
  },
  'custom-timeout': {
    label: 'If longer than %1',
    icon: bellClockIcon
  }
}

interface INotifySettings {
  defaultMode: ModeId
  failureMessage: string
  mail: boolean
  slack: boolean
  successMessage: string
  threshold: number | null
}

interface ICellMetadata {
  mode: ModeId;
}

interface IInitialResponse {
  nbmodel_installed: boolean,
  email_configured: boolean
  slack_configured: boolean
}

/**
 * Initialization data for the jupyterlab-notify extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-notify:plugin',
  description: '',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [IToolbarWidgetRegistry, ITranslator, ISettingRegistry],
  activate: async (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    toolbarRegistry: IToolbarWidgetRegistry | null,
    translator: ITranslator | null,
    settingRegistry: ISettingRegistry | null,
  ) => {
    console.log('JupyterLab extension jupyterlab-notify is activated!');
    let notifySettings: INotifySettings = {
      defaultMode: "never",
      failureMessage: "Cell execution failed",
      mail: false,
      slack: false,
      successMessage: "Cell execution completed successfully",
      threshold: null,
    }

    const updateSettings = (setting: ISettingRegistry.ISettings)=>{
      notifySettings = {...notifySettings, ...setting.composite}
    }

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          updateSettings(settings);
          settings.changed.connect(updateSettings);
        })
        .catch(reason => {
          console.error('Failed to load settings for jupyterlab-notify.', reason);
        });
    }

    let config: IInitialResponse = {
      nbmodel_installed: false,
      email_configured: false,
      slack_configured: false
    }

    // Check server capability
    try{
      const response = await requestAPI<IInitialResponse>('notify');
      config = response
      
    } catch(e){
      console.error("Checking server capability failed",e)
    }


    const trans = (translator ?? nullTranslator).load('jupyterlab-notify');
      app.commands.addCommand(CommandIDs.toggleCellNotifications, {
      label: args => {
        const current = tracker.currentWidget;
        return trans._n(
          'Toggle Notifications for Selected Cell',
          'Toggle Notifications for %1 Selected Cells',
          current?.content.selectedCells.length ?? 1,
        );
      },
      execute: args => {
        const current = tracker.currentWidget;
        if (!current) {
          console.warn(
            'Cannot toggle notifications on cells - no notebook selected',
          );
          return;
        }
        for (const cell of current.content.selectedCells) {
          const oldMetadata = cell.model.getMetadata(CELL_METADATA_KEY) as ICellMetadata | undefined;
          const oldModeId = oldMetadata?.mode ?? notifySettings.defaultMode;
          let nextModeIndex = ModeIds.indexOf(oldModeId) + 1;
          if (nextModeIndex >= ModeIds.length) {
            nextModeIndex = 0;
          }
          const newModeId = ModeIds[nextModeIndex];
          const metadata: ICellMetadata = {...oldMetadata, mode: newModeId}
          cell.model.setMetadata(CELL_METADATA_KEY, metadata);
          app.commands.notifyCommandChanged(CommandIDs.toggleCellNotifications);
        }
      },
      icon: args => {
        if (!args.toolbar) {
          return undefined;
        }
        const current = tracker.currentWidget;
        if (!current) {
          return undefined;
        }
        const cell = current.content.selectedCells[0];
        const metadata = cell.model.getMetadata(CELL_METADATA_KEY) as ICellMetadata | undefined;
        const modeId = metadata?.mode ?? notifySettings.defaultMode;
        const mode = MODES[modeId];
        return mode.icon;
      },
      isEnabled: args => (args.toolbar ? true : !!tracker.currentWidget),
    });

    if (toolbarRegistry) {
      // TODO: add a dropdown to select timeout
      const itemFactory = createDefaultFactory(app.commands);
      toolbarRegistry.addFactory('Cell', 'notify', widget => {
        const toolbarButton = itemFactory('Cell', widget, {
          name: 'notify',
          command: CommandIDs.toggleCellNotifications,
        });
        // const dropDownButton = new
        return toolbarButton
      });
    }

    NotebookActions.executionScheduled.connect(async (_, args) => {
      const { cell } = args;
      const cellMetadata = cell.model.getMetadata(CELL_METADATA_KEY) as ICellMetadata;
      const mode = cellMetadata?.mode ?? notifySettings.defaultMode;
      if(mode==="never") return;
      if(notifySettings.mail && !config.email_configured){
        Notification.emit('Email Not Configured', 'error', {
          autoClose: 3000,
          actions: [
            {
              label: 'Help',
              callback: () => {
                showErrorMessage('Email hasn\'t been configured in the config file', {
                  message: `Email hasn't been configured in the config file, so notifications via email won't work. To stop seeing this warning, either disable email notifications in settings or add an email in \`~/.jupyter/jupyterlab_notify_config.json\` as:\n{
                    "email": "your-email@example.com"
                  }`
                });
              }
            }
          ]
        });
      }
      if(notifySettings.slack && !config.slack_configured){
        Notification.emit('Slack Not Configured', 'error', {
          autoClose: 3000,
          actions: [
            {
              label: 'Help',
              callback: () => {
                showErrorMessage('Slack hasn\'t been configured in the config file', {
                  message: `Slack hasn\'t been configured in the config file, so notifications via Slack won\'t work. To stop seeing this warning, either disable Slack notifications in settings or add a Slack token in \`~/.jupyter/jupyterlab_notify_config.json\` as:\n{
                  "slack_token": "xoxb-your-slack-token",
                  "slack_channel_name": "your-channel-name"
                }`
                });
              }
            }
          ]
        });
      }
      const emailEnabled = config.email_configured && notifySettings.mail
      const slackEnabled = config.slack_configured && notifySettings.slack
      try {
        const payload = {
          cell_id: cell.model.id,
          mode,
          emailEnabled,
          slackEnabled,
          successMessage: notifySettings.successMessage,
          failureMessage: notifySettings.failureMessage,
          threshold: notifySettings.threshold,
        }
        if(config.nbmodel_installed){
            // Register with server
            await requestAPI('notify', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
        } else {
          // Fallback to client-side trigger
          const listener = async (_:any,args:any) => {
            if (args.cell.model.id === cell.model.id) {
              await requestAPI('notify-trigger', {
                method: 'POST',
                body: JSON.stringify({
                ...payload,
                success: args.success,
                error: args.error ?? null
                }),
              }).catch(console.error);
              //Disconnect the listener
              NotebookActions.executed.disconnect(listener);
            }
          };
          NotebookActions.executed.connect(listener);
        }
      } catch (error) {
        console.error('Notification registration failed:', error);
      }
  });
  },
};

export default plugin;
