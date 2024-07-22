import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { bellIcon, editIcon } from '@jupyterlab/ui-components';
import {
  createDefaultFactory,
  IToolbarWidgetRegistry,
} from '@jupyterlab/apputils';
namespace CommandIDs {
  export const toggleCellNotifications = 'toggle-cell-notifications';
}

const CELL_METADATA_KEY = 'jupyterlab_notify.notify';

/**
 * Initialization data for the {{ labextension_name }} extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-notify:plugin',
  description: '',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [IToolbarWidgetRegistry, ITranslator, ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    toolbarRegistry: IToolbarWidgetRegistry | null,
    translator: ITranslator | null,
    settingRegistry: ISettingRegistry | null,
  ) => {
    console.log('JupyterLab extension jupyterlab-notify is activated!');

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
          const mode = cell.model.getMetadata(CELL_METADATA_KEY);
          // TODO: define modes, say: never/always/on failure/after timeout
          // TODO: add a dropdown to select timeout
          // TODO: add different variants of the icon, ideally a smaller icon
          let newMode: string;
          switch (mode) {
            case 'always':
              newMode = 'never';
              break;
            case 'never':
              newMode = 'always';
              break;
            default:
              newMode = 'always';
              break;
          }
          cell.model.setMetadata(CELL_METADATA_KEY, newMode);
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
        const mode = cell.model.getMetadata(CELL_METADATA_KEY);
        if (mode === 'always') {
          return editIcon;
        }
        return bellIcon;
      },
      isEnabled: args => (args.toolbar ? true : !!tracker.currentWidget),
    });

    if (toolbarRegistry) {
      const itemFactory = createDefaultFactory(app.commands);
      toolbarRegistry.addFactory('Cell', 'notify', widget => {
        return itemFactory('Cell', widget, {
          name: 'notify',
          command: CommandIDs.toggleCellNotifications,
        });
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
  },
};

export default plugin;
