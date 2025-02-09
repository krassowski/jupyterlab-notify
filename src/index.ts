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
} from '@jupyterlab/apputils';
import { bellOutlineIcon, bellFilledIcon, bellOffIcon, bellAlertIcon } from './icons';
import { requestAPI } from './handler';

namespace CommandIDs {
  export const toggleCellNotifications = 'toggle-cell-notifications';
}

const CELL_METADATA_KEY = 'jupyterlab_notify.notify';


interface IMode {
  label: string;
  icon: LabIcon;
}

const ModeIds = ['always', 'never', 'on-error', 'global-timeout', 'custom-timeout', 'email', 'slack', 'email-and-slack'] as const;
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
    icon: bellOutlineIcon // TODO: custom icon with a tiny clock
  },
  'email': {
    label: 'Email Notification',
    icon: bellOutlineIcon // TODO: custom icon with a tiny mail
  },
  'slack': {
    label: 'Slack Notification',
    icon: bellOutlineIcon // TODO: custom icon with a tiny slack
  },
  'email-and-slack': {
    label: 'Email and Slack Notification',
    icon: bellOutlineIcon // TODO: custom icon with a tiny email and slack
  }
}


interface ICellMetadata {
  mode: ModeId;
  email?: boolean;
  slack?: boolean;
  timeoutSeconds?: number;
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
    // TODO make it customizable
    const defaultMode = 'global-timeout';

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
          const oldModeId = oldMetadata?.mode ?? defaultMode;
          let nextModeIndex = ModeIds.indexOf(oldModeId) + 1;
          if (nextModeIndex >= ModeIds.length) {
            nextModeIndex = 0;
          }
          const newModeId = ModeIds[nextModeIndex];
          const metadata: ICellMetadata = {...oldMetadata, mode: newModeId, slack: false, email: false}
          if (newModeId === 'email'){
            metadata.email = true;
          }
          else if(newModeId === 'slack'){
            metadata.slack = true;
          }
          else if(newModeId === 'email-and-slack'){
            metadata.email = true;
            metadata.slack = true;
          }
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
        const modeId = metadata?.mode ?? defaultMode;
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

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log('jupyterlab-notify settings loaded:', settings.composite);
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

    NotebookActions.executionScheduled.connect(async (_, args) => {
      const { cell } = args;
      const notifyEnabled = cell.model.getMetadata(CELL_METADATA_KEY) as ICellMetadata;
      if (notifyEnabled) {
        const mode = notifyEnabled.mode;
        const emailEnabled = config.email_configured && notifyEnabled.email
        const slackEnabled = config.slack_configured && notifyEnabled.slack
        try {
          if(config.nbmodel_installed){
              // Register with server
              await requestAPI('notify', {
                method: 'POST',
                body: JSON.stringify({ cell_id: cell.model.id, mode, emailEnabled, slackEnabled}),
              });
          } else {
            // Fallback to client-side trigger
            const listener = async (_:any,args:any) => {
              if (args.cell.model.id === cell.model.id) {
                await requestAPI('notify-trigger', {
                  method: 'POST',
                  body: JSON.stringify({ cell_id: cell.model.id, mode, emailEnabled, slackEnabled, success: args.success}),
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
      }
    });
  },
};

export default plugin;
