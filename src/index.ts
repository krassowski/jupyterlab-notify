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
    icon: bellOutlineIcon // TODO: custom icon with a tiny clock
  }
}


interface ICellMetadata {
  mode: ModeId;
  timeoutSeconds?: number;
}

interface INbModelResponse {
  nbmodel_installed: boolean
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
          cell.model.setMetadata(CELL_METADATA_KEY, {...oldMetadata, mode: newModeId});
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

    let nbmodel_installed = false

    // Check server capability
    try{
      const response = await requestAPI<INbModelResponse>('notify');
      nbmodel_installed = response.nbmodel_installed
      
    } catch(e){
      console.error("Checking server capability failed",e)
    }

    NotebookActions.executionScheduled.connect(async (_, args) => {
      const { cell } = args;
      const notifyEnabled = cell.model.getMetadata(CELL_METADATA_KEY);
      if (notifyEnabled) {
        try {
          if(nbmodel_installed){
              // Register with server
              await requestAPI('notify', {
                method: 'POST',
                body: JSON.stringify({ cell_id: cell.model.id }),
              });
          } else {
            // Fallback to client-side trigger
            const listener = async (_:any,args:any) => {
              if (args.cell.model.id === cell.model.id) {
                await requestAPI('notify-trigger', {
                  method: 'POST',
                  body: JSON.stringify({ cell_id: cell.model.id }),
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
